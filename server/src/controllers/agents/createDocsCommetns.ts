import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { parseStringPromise, Builder } from "xml2js";

export type ExtractedItem = Record<string, string | boolean | null>;
export interface TopicItems {
  topic: string;
  items: ExtractedItem[];
}

type Range = { start: number; end: number };

function normalizeForSearch(s: string): string {
  return s
    // remove common bullet/numbering prefixes per line
    .replace(/^\s*(?:[\u2022•·●\-–—]\s*)+/gm, "")
    .replace(/^\s*\d+[\.\)]\s*/gm, "")
    // remove bullet
    .replace(/[\u2022•·●\-–—]+/g, "")
    // remove all whitespace everywhere
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000]+/g, "")
    .toLowerCase();
}

function isIgnorableChar(ch: string): boolean {
  if (!ch) return true;
  if (/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000]/.test(ch)) return true;
  if (/[\u2022•·●\-–—]/.test(ch)) return true;
  return false;
}

function getRunText(run: any): string {
  const t = run?.["w:t"];
  if (!t) return "";
  if (Array.isArray(t)) {
    return t.map((x: any) => (typeof x === "string" ? x : x?._ ?? "")).join("");
  }
  return typeof t === "string" ? t : t?._ ?? "";
}

function cloneRunWithText(baseRun: any, text: string, makeGreen: boolean): any {
  const run = JSON.parse(JSON.stringify(baseRun));
  run["w:rPr"] = run["w:rPr"] ?? [{}];

  if (makeGreen) {
    const rPr0 = run["w:rPr"][0] ?? (run["w:rPr"][0] = {});
    rPr0["w:color"] = [{ $: { "w:val": "00B050" } }]; // green
  }

  run["w:t"] = [{ _: text, $: { "xml:space": "preserve" } }];
  return run;
}

function applyRangesToRuns(runs: any[], ranges: Range[]): any[] {
  if (!ranges.length) return runs;

  const out: any[] = [];
  let offset = 0;

  for (const run of runs) {
    const text = getRunText(run);

    if (!text) {
      out.push(run);
      continue;
    }

    const runStart = offset;
    const runEnd = offset + text.length;

    const overlaps = ranges
      .map((r) => ({ a: Math.max(r.start, runStart), b: Math.min(r.end, runEnd) }))
      .filter((x) => x.a < x.b)
      .map((x) => ({ start: x.a - runStart, end: x.b - runStart }));

    if (!overlaps.length) {
      out.push(run);
      offset += text.length;
      continue;
    }

    overlaps.sort((a, b) => a.start - b.start);

    let cursor = 0;
    for (const ov of overlaps) {
      if (ov.start > cursor) out.push(cloneRunWithText(run, text.slice(cursor, ov.start), false));
      out.push(cloneRunWithText(run, text.slice(ov.start, ov.end), true));
      cursor = ov.end;
    }
    if (cursor < text.length) out.push(cloneRunWithText(run, text.slice(cursor), false));

    offset += text.length;
  }

  return out;
}

function mergeRanges(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);

  const merged: Range[] = [];
  for (const r of sorted) {
    if (merged.length === 0) {
      merged.push({ start: r.start, end: r.end });
      continue;
    }
    const last = merged[merged.length - 1];
    if (r.start > last.end) merged.push({ start: r.start, end: r.end });
    else last.end = Math.max(last.end, r.end);
  }
  return merged;
}

function collectNeedlesFromTopicItems(topics: TopicItems[]): string[] {
  const needles: string[] = [];
  for (const t of topics) {
    for (const it of t.items ?? []) {
      for (const v of Object.values(it)) {
        if (typeof v === "string" && v.trim()) needles.push(v);
      }
    }
  }
  return needles;
}

async function highlightGreenInDocxFromTopicItems(
  docxBuffer: Buffer,
  topics: TopicItems[],
  opts?: { minNormalizedLen?: number }
): Promise<Buffer> {
  const minNormalizedLen = opts?.minNormalizedLen ?? 2;

  const rawNeedles = collectNeedlesFromTopicItems(topics);

  const needleNorms: string[] = [];
  const seen = new Set<string>();
  for (const s of rawNeedles) {
    const n = normalizeForSearch(s);
    if (n.length < minNormalizedLen) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    needleNorms.push(n);
  }
  if (needleNorms.length === 0) return docxBuffer;

  const zip = new AdmZip(docxBuffer);
  const entry = zip.getEntry("word/document.xml");
  if (!entry) return docxBuffer;

  const xml = entry.getData().toString("utf8");

  const doc = await parseStringPromise(xml, {
    explicitArray: true,
    explicitCharkey: true,
    trim: false,
    normalize: false,
  });

  const body = doc?.["w:document"]?.["w:body"]?.[0];
  const paragraphs: any[] = body?.["w:p"] ?? [];
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return docxBuffer;

  const map: Array<{ pIdx: number; paraCharIdx: number }> = [];
  let docNorm = "";

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const p = paragraphs[pIdx];
    const runs: any[] = p?.["w:r"] ?? [];
    const paraText = Array.isArray(runs) ? runs.map(getRunText).join("") : "";

    for (let i = 0; i < paraText.length; i++) {
      const ch = paraText.charAt(i);
      if (isIgnorableChar(ch)) continue;

      docNorm += ch.toLowerCase();
      map.push({ pIdx, paraCharIdx: i });
    }
  }

  if (!docNorm) return docxBuffer;

  const matches: Array<{ start: number; end: number }> = [];
  for (const needle of needleNorms) {
    let from = 0;
    while (true) {
      const idx = docNorm.indexOf(needle, from);
      if (idx === -1) break;
      matches.push({ start: idx, end: idx + needle.length });
      from = idx + Math.max(1, needle.length);
    }
  }
  if (matches.length === 0) return docxBuffer;

  const rangesByParagraph: Range[][] = Array.from({ length: paragraphs.length }, () => []);

  for (const m of matches) {
    const minByP = new Map<number, number>();
    const maxByP = new Map<number, number>();

    for (let k = m.start; k < m.end; k++) {
      const loc = map[k];
      if (!loc) continue;

      const { pIdx, paraCharIdx } = loc;
      const curMin = minByP.get(pIdx);
      const curMax = maxByP.get(pIdx);

      if (curMin === undefined || paraCharIdx < curMin) minByP.set(pIdx, paraCharIdx);
      if (curMax === undefined || paraCharIdx > curMax) maxByP.set(pIdx, paraCharIdx);
    }

    for (const [pIdx, min] of minByP.entries()) {
      const max = maxByP.get(pIdx);
      if (max === undefined) continue;
      rangesByParagraph[pIdx].push({ start: min, end: max + 1 });
    }
  }

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const p = paragraphs[pIdx];
    const runs: any[] = p?.["w:r"] ?? [];
    if (!Array.isArray(runs) || runs.length === 0) continue;

    const merged = mergeRanges(rangesByParagraph[pIdx] ?? []);
    if (merged.length === 0) continue;

    p["w:r"] = applyRangesToRuns(runs, merged);
  }

  const builder = new Builder({ headless: true, renderOpts: { pretty: false } });
  const newXml = builder.buildObject(doc);

  zip.updateFile("word/document.xml", Buffer.from(newXml, "utf8"));
  return zip.toBuffer();
}

function safeFilePart(s: string): string {
  return s
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function outNameFromInput(inputPath: string): string {
  const base = path.basename(inputPath, path.extname(inputPath));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = crypto.randomBytes(4).toString("hex");
  return `${safeFilePart(base)}__comments__${stamp}__${rand}.docx`;
}

export async function processDocument(
  ABS_PATH: string,
  items: TopicItems[],
  outputDir: string
): Promise<string> {
  const inBuf = await fs.readFile(ABS_PATH);
  const outBuf = await highlightGreenInDocxFromTopicItems(inBuf, items);

  await fs.mkdir(outputDir, { recursive: true });

  const outFile = outNameFromInput(ABS_PATH);
  const outPath = path.resolve(outputDir, outFile);

  await fs.writeFile(outPath, outBuf);
  return outPath;
}

export const createDocsComments = { processDocument };