import fs from "fs/promises";
import path from "path";
import AdmZip from "adm-zip";
import { parseStringPromise } from "xml2js";

export interface BlockMeta {
  line: string;
  fontSize: number;
  bold: boolean;
  underline: boolean;
  color: string;
  bullet?: "•" | "number";
  index?: number;
}

let blockCounter = 1;

function resetRegistry() {
  blockCounter = 1;
}

function formatBlock(meta: BlockMeta): string {
  const { line, bullet, index, fontSize, bold, underline, color } = meta;

  const id = blockCounter++;

  let prefix = "";
  if (bullet === "•") prefix = "• ";
  if (bullet === "number") prefix = `${index}. `;

  const attrs =
    `fs="${fontSize}" b="${bold ? 1 : 0}" u="${underline ? 1 : 0}" c="${color}"` +
    (bullet ? ` bl="${bullet}"` : "") +
    (index != null ? ` i="${index}"` : "");

  return `<block_${id} ${attrs}>${prefix}${line}</block_${id}>`;
}

function getHeader(): string {
  return "--- DOCUMENT CONTENT ---\n\n";
}

function styleKey(meta: Omit<BlockMeta, "line">): string {
  const { fontSize, bold, underline, color, bullet, index } = meta;
  return `fs:${fontSize}|b:${bold ? 1 : 0}|u:${underline ? 1 : 0}|c:${color}|bl:${bullet ?? ""}|i:${index ?? ""}`;
}

function normalizeSegmentText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeSegmentTextKeepNewlines(s: string): string {
  const parts = s.split(/\r?\n/);
  const normalized = parts.map((p) => p.replace(/\s+/g, " ").trim());
  return normalized.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function appendPdfText(prev: string, next: string): string {
  const a = prev ?? "";
  const b = next ?? "";
  if (!a) return b;

  if (/^[,.;:!?)]/.test(b)) return a + b;

  if (/-$/.test(a)) return a + b;

  if (!/\s$/.test(a)) return a + " " + b;
  return a + b;
}

function appendSmart(prev: string, next: string): string {
  const a = prev ?? "";
  const b = next ?? "";
  if (!a) return b;
  if (!b) return a;

  if (/\s$/.test(a) || /^\s/.test(b)) return a + b;

  if (/^[,.;:!?)]/.test(b)) return a + b;

  if (/^[(\[]/.test(b)) return a + b;

  if (/-$/.test(a)) return a + b;

  const aEndsWord = /[\p{L}\p{N}]$/u.test(a);
  const bStartsWord = /^[\p{L}\p{N}]/u.test(b);
  if (aEndsWord && bStartsWord) return a + " " + b;

  return a + b;
}


async function readPdf(p: string): Promise<string> {
  try {
    const PDFParser = (await import("pdf2json")).default;
    const pdfParser = new (PDFParser as any)(null, 1);

    return new Promise((resolve, reject) => {
      pdfParser.on("pdfParser_dataError", (errData: any) =>
        reject(errData.parserError)
      );
      pdfParser.on("pdfParser_dataReady", (pdfData: any) => {
        let output = "";

        pdfData.Pages.forEach((page: any) => {
          const segments: Array<{
            y: number;
            meta: Omit<BlockMeta, "line">;
            key: string;
            text: string;
          }> = [];

          const yTol = 0.25;

          for (const t of page.Texts || []) {
            const str = decodeURIComponent(t.R?.[0]?.T ?? "").trim();
            if (!str) continue;

            const ts = t.R?.[0]?.TS ?? [];
            const meta: Omit<BlockMeta, "line"> = {
              fontSize: Math.round(ts[1] ?? 0),
              bold: ts[2] === 1,
              underline: false,
              color: t.clr ? t.clr : "black",
            };

            const key = styleKey(meta);
            const y = typeof t.y === "number" ? t.y : Number(t.y ?? 0);

            const last = segments[segments.length - 1];
            const sameLine = last && Math.abs(last.y - y) <= yTol;
            const sameStyle = last && last.key === key;

            if (last && sameLine && sameStyle) {
              last.text = appendPdfText(last.text, str);
            } else {
              segments.push({ y, meta, key, text: str });
            }
          }

          for (const seg of segments) {
            const line = normalizeSegmentText(seg.text);
            if (!line) continue;
            output += formatBlock({ ...seg.meta, line }) + " ";
          }

          output += "\n";
        });

        resolve(output);
      });

      pdfParser.loadPDF(p);
    });
  } catch {
    return "";
  }
}

async function readDocx(p: string): Promise<string> {
  try {
    const fileBuffer = await fs.readFile(p);
    const zip = new AdmZip(fileBuffer);
    const contentXml = zip.readAsText("word/document.xml");
    const result = await parseStringPromise(contentXml);
    let output = "";
    const paragraphs = result["w:document"]["w:body"][0]["w:p"] || [];

    for (const pNode of paragraphs) {
      let bulletType: "•" | "number" | undefined;
      let bulletIndex: number | undefined;

      if (pNode["w:pPr"] && pNode["w:pPr"][0]["w:numPr"]) {
        const numPr = pNode["w:pPr"][0]["w:numPr"][0];
        const numId = numPr["w:numId"]?.[0].$["w:val"];
        bulletType = numId === "1" || numId === "2" ? "•" : "number";
        bulletIndex = 1; 
      }

      const runs = pNode["w:r"] || [];
      const segments: Array<{
        meta: Omit<BlockMeta, "line">;
        key: string;
        text: string;
      }> = [];

      for (const run of runs) {
        const hasSoftBreak = !!run["w:br"]?.length;

        const textNode = run["w:t"];
        const rawTextBase = textNode
          ? typeof textNode[0] === "string"
            ? textNode[0]
            : textNode[0]._
          : "";

        const rawText = hasSoftBreak
          ? rawTextBase
            ? rawTextBase + "\n"
            : "\n"
          : rawTextBase;

        if (!rawText) continue;

        let color = "000000";
        let fontSize = 20;
        let bold = false;
        let underline = false;

        if (run["w:rPr"] && run["w:rPr"][0]) {
          const rPr = run["w:rPr"][0];
          if (rPr["w:color"]) color = rPr["w:color"][0].$["w:val"];
          if (rPr["w:sz"]) fontSize = parseInt(rPr["w:sz"][0].$["w:val"]);
          if (rPr["w:b"]) bold = true;
          if (rPr["w:u"]) underline = true;
        }

        const meta: Omit<BlockMeta, "line"> = {
          fontSize,
          bold,
          underline,
          color: `#${color}`,
          bullet: bulletType,
          index: bulletIndex,
        };

        const key = styleKey(meta);
        const last = segments[segments.length - 1];

        if (last && last.key === key) {
          last.text = appendSmart(last.text, rawText);
        } else {
          segments.push({ meta, key, text: rawText });
        }
      }

      for (const seg of segments) {
        const line = normalizeSegmentTextKeepNewlines(seg.text);
        if (!line) continue;
        output += formatBlock({ ...seg.meta, line }) + " ";
      }

      output += "\n";
    }

    return output;
  } catch {
    return "";
  }
}

export async function load_document_text(filePath: string): Promise<string> {
  resetRegistry();

  const ext = path.extname(filePath).toLowerCase();
  let body = "";

  if (ext === ".pdf") body = await readPdf(filePath);
  else if (ext === ".docx") body = await readDocx(filePath);
  else body = await fs.readFile(filePath, "utf8");

  return getHeader() + body;
}