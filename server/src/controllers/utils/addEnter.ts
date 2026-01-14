import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

type AnyNode = Record<string, any>;

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function getTagKey(node: AnyNode): string | null {
  const keys = Object.keys(node).filter((k) => k !== ":@");
  if (keys.length !== 1) return null;
  return keys[0];
}

function isTextWrappingLineBreak(brNode: AnyNode): boolean {
  const attrs = brNode[":@"] || {};
  const t = attrs["w:type"] ?? attrs["type"];
  if (!t) return true;
  return t === "textWrapping";
}

function splitParagraphNode(pNode: AnyNode): AnyNode[] {
  const pKey = getTagKey(pNode);
  if (pKey !== "w:p") return [pNode];

  const pAttrs = pNode[":@"] ? deepClone(pNode[":@"]) : undefined;
  const children: AnyNode[] = Array.isArray(pNode["w:p"]) ? pNode["w:p"] : [];

  const pPrNodes: AnyNode[] = [];
  const contentNodes: AnyNode[] = [];

  for (const ch of children) {
    const k = getTagKey(ch);
    if (k === "w:pPr") pPrNodes.push(ch);
    else contentNodes.push(ch);
  }

  const segments: AnyNode[][] = [[]]; 
  let segIdx = 0;

  const pushToCurrent = (node: AnyNode) => segments[segIdx].push(node);
  const newSegment = () => {
    segments.push([]);
    segIdx++;
  };

  const finalizeRunIfHasContent = (runAttrs: any, rPr: AnyNode[] | null, runKids: AnyNode[]) => {
    const kids: AnyNode[] = [];
    if (rPr && rPr.length) kids.push(...deepClone(rPr));
    kids.push(...runKids);

    const hasReal = kids.some((n) => {
      const k = getTagKey(n);
      if (!k) return false;
      if (k === "w:rPr") return false;
      if (k === "#text") return String(n["#text"] ?? "").length > 0;
      return true;
    });

    if (!hasReal) return;

    const runNode: AnyNode = { "w:r": kids };
    if (runAttrs) runNode[":@"] = deepClone(runAttrs);
    pushToCurrent(runNode);
  };

  let changed = false;

  for (const node of contentNodes) {
    const k = getTagKey(node);

    if (k !== "w:r") {
      pushToCurrent(node);
      continue;
    }

    const runAttrs = node[":@"] || null;
    const runChildren: AnyNode[] = Array.isArray(node["w:r"]) ? node["w:r"] : [];

    const rPr: AnyNode[] = [];
    const flatRunKids: AnyNode[] = [];

    for (const rc of runChildren) {
      const rk = getTagKey(rc);
      if (rk === "w:rPr") rPr.push(rc);
      else flatRunKids.push(rc);
    }

    let curRunKids: AnyNode[] = [];

    for (const rc of flatRunKids) {
      const rk = getTagKey(rc);

      if (rk === "w:br" && isTextWrappingLineBreak(rc)) {
        changed = true;

        finalizeRunIfHasContent(runAttrs, rPr, curRunKids);
        curRunKids = [];
        newSegment();
        continue;
      }

      curRunKids.push(rc);
    }

    finalizeRunIfHasContent(runAttrs, rPr, curRunKids);
  }

  if (!changed) return [pNode];

  // Build new paragraphs: each gets pPr at the start
  const outParas: AnyNode[] = segments.map((seg) => {
    const kids: AnyNode[] = [];
    if (pPrNodes.length) kids.push(...deepClone(pPrNodes));
    kids.push(...seg);

    const out: AnyNode = { "w:p": kids };
    if (pAttrs) out[":@"] = pAttrs;
    return out;
  });

  return outParas;
}

function processPreserveOrderNodes(nodes: AnyNode[]): AnyNode[] {
  const out: AnyNode[] = [];

  for (const node of nodes) {
    const k = getTagKey(node);

    if (!k) {
      out.push(node);
      continue;
    }

    if (k === "w:p") {
      out.push(...splitParagraphNode(node));
      continue;
    }

    const val = node[k];
    if (Array.isArray(val)) {
      const nextNode = deepClone(node);
      nextNode[k] = processPreserveOrderNodes(val);
      out.push(nextNode);
    } else {
      out.push(node);
    }
  }

  return out;
}

function convertXmlSoftBreaksToParagraphs(xml: string): string {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    trimValues: false,
    processEntities: false,
  });

  const builder = new XMLBuilder({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: "",
    format: false,
    suppressEmptyNode: false,
  });

  const parsed = parser.parse(xml) as AnyNode[];
  const updated = processPreserveOrderNodes(parsed);
  return builder.build(updated);
}


export async function convertDocxShiftEnterToEnter(docxBuffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docxBuffer);

  const targets = Object.keys(zip.files).filter((name) => {
    return (
      name === "word/document.xml" ||
      /^word\/header\d+\.xml$/.test(name) ||
      /^word\/footer\d+\.xml$/.test(name) ||
      name === "word/footnotes.xml" ||
      name === "word/endnotes.xml" ||
      name === "word/comments.xml"
    );
  });

  for (const name of targets) {
    const file = zip.file(name);
    if (!file) continue;

    const xml = await file.async("string");
    const newXml = convertXmlSoftBreaksToParagraphs(xml);

    if (newXml !== xml) {
      zip.file(name, newXml);
    }
  }

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}