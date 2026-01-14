import fs from "fs/promises";
import path from "path";
import JSZip from "jszip";
import { XMLParser, XMLBuilder } from "fast-xml-parser";

const STRICT_EQUALS = false; 
const DEBUG = true;
const MAX_LOG_CHARS = 200;
const PARA_FILL_HEX = "B7F7A5"; // light green
const RUN_HIGHLIGHT = "yellow";

export type TopicBlock = { topic: string; items?: unknown[] };

export const my_items: TopicBlock[] = [
  { topic: "GTel AI FAQS", items: [] },
  {
    topic: "SALES",
    items: [
      {
        Question: "Which phones do you have in stock?",
        Answer: "Currently, we only have the Delta 16 and the Vivo Plus in stock.",
      },
      {
        Question: "What are the specifications of your latest phone - Delta 16?",
        Answer:
          "Our latest phone is the Delta 16, whose specifications are as follows: 📸 108MP AI Rear Camera + 32MP AI Front Camera 💾 128GB Internal Storage ⚙️ 14GB RAM (6GB physical + 8GB virtual) 📱 6.7” HD+ Hole-Punch Display 🔋 5000mAh Battery 📲 Runs on Android 14 🎨 Available Colours: Black & Titanium",
      },
      {
        Question: "What are the specifications of the Vivo Plus?",
        Answer:
          "The Vivo Plus specifications are as follows: 📱 5.5-inch Display 📸 8MP Front & Rear Cameras 💾 32GB Internal Storage (Expandable up to 128GB) ⚙️ 2GB RAM 🔋 2500mAh Battery 📲 Runs on Android 13 ⚡ Powered by Quad Core 1.5GHz Processor 🌐 Supports 4G Connectivity 🔄 Dual SIM Slots 🎨 Available Colours: Green",
      },
    ],
  },
];

function collectPrimitiveValues(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(collectPrimitiveValues);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap(collectPrimitiveValues);
  return [];
}

export function toValuesArray(blocks: TopicBlock[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    const items = Array.isArray(block.items) ? block.items : [];
    for (const item of items) out.push(...collectPrimitiveValues(item).map(s => s.trim()).filter(Boolean));
  }
  if (DEBUG) {
    console.log("\n[DEBUG] Extracted item values (%d):", out.length);
    for (const v of out) console.log("  •", v);
  }
  return out;
}

function normalizeKeepLettersDigits(s: string): string {
  if (!s) return "";
  return s.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{Nd}]+/gu, "");
}

const DECIMAL_DOT = /(?<=\d)\.(?=\d)/g;

function hasSplitterCharUnicode(s: string): boolean {
  const PROTECT = "\uE000";
  const protectedStr = s.replace(DECIMAL_DOT, PROTECT);
  for (const ch of protectedStr) {
    if (!/[\p{L}\p{Nd}\s]/u.test(ch) && ch !== PROTECT) return true;
  }
  return false;
}

function safeSplitByUnicodeSymbols(s: string): string[] {
  const PROTECT = "\uE000";
  const protectedStr = s.replace(DECIMAL_DOT, PROTECT);

  const parts: string[] = [];
  let cur = "";
  for (const ch of protectedStr) {
    if (/[\p{L}\p{Nd}\s]/u.test(ch) || ch === PROTECT) {
      cur += ch;
    } else {
      if (cur.trim()) parts.push(cur);
      cur = "";
    }
  }
  if (cur.trim()) parts.push(cur);

  return parts
    .map(t => t.replace(new RegExp(PROTECT, "g"), "."))
    .map(t => t.replace(/\s+/g, " ").trim())
    .filter(t => t.length > 0);
}

function explodeNeedleIntoSubclauses(s: string): string[] {
  const parts = safeSplitByUnicodeSymbols(s);
  return parts.filter(t => normalizeKeepLettersDigits(t).length >= 8);
}

function expandNeedles(items: string[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (hasSplitterCharUnicode(it)) {
      const parts = explodeNeedleIntoSubclauses(it);
      out.push(...(parts.length ? parts : [it]));
    } else {
      out.push(it);
    }
  }

  const seen = new Set<string>();
  const dedup: string[] = [];
  for (const s of out) {
    const k = normalizeKeepLettersDigits(s);
    if (!seen.has(k)) { seen.add(k); dedup.push(s); }
  }
  if (DEBUG) {
    console.log("\n[DEBUG] Needles after clause expansion & dedup (%d):", dedup.length);
    dedup.forEach((v, i) => console.log(`  [${i}] ${v}  →  ${normalizeKeepLettersDigits(v)}`));
  }
  return dedup;
}

type XmlObj = any;
const clip = (s: string, n = MAX_LOG_CHARS) => (s.length <= n ? s : s.slice(0, n) + " …");

function ensureArray<T>(v: T | T[] | undefined): T[] { return v == null ? [] : (Array.isArray(v) ? v : [v]); }
function ensureRunProps(run: any) { if (!run["w:rPr"]) run["w:rPr"] = {}; return run["w:rPr"]; }
function ensureParaProps(p: any) { if (!p["w:pPr"]) p["w:pPr"] = {}; return p["w:pPr"]; }

function applyHighlightToRun(run: any, color = RUN_HIGHLIGHT, fillHex = PARA_FILL_HEX) {
  const rPr = ensureRunProps(run);
  rPr["w:highlight"] = { "@_w:val": color };
  rPr["w:shd"] = { "@_w:val": "clear", "@_w:color": "auto", "@_w:fill": fillHex };
  rPr["w:b"] = {};
}

function applyParagraphShading(para: any, fillHex = PARA_FILL_HEX) {
  const pPr = ensureParaProps(para);
  pPr["w:shd"] = { "@_w:val": "clear", "@_w:color": "auto", "@_w:fill": fillHex };
}

function visitParagraphsDeep(node: XmlObj, cb: (p: XmlObj) => void) {
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if (k === "w:p") {
      const arr = ensureArray(v);
      for (const p of arr) cb(p);
    } else if (v && typeof v === "object") {
      visitParagraphsDeep(v as XmlObj, cb);
    }
  }
}

function probePartForNeedles(xml: string, partName: string, needlesNorm: string[], foundCounts: number[]) {
  if (!DEBUG) return;
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: false, attributeNamePrefix: "@_" });
  const root: XmlObj = parser.parse(xml);

  console.log(`\n[DEBUG][${partName}] Probing paragraphs vs needles…`);
  let paraIdx = 0;

  visitParagraphsDeep(root, (para) => {
    const runs = ensureArray(para["w:r"]);
    if (!runs.length) return;

    let text = "";
    for (const run of runs) {
      const texts = ensureArray(run["w:t"]);
      for (const t of texts) text += typeof t === "string" ? t : (t?.["#text"] ?? "");
    }
    if (!text) return;

    let norm = "";
    for (const ch of text) {
      const decomp = ch.normalize("NFKD");
      if (/[\p{L}\p{Nd}]/u.test(decomp)) norm += decomp.toLowerCase();
    }

    const hits: string[] = [];
    needlesNorm.forEach((n, i) => {
      const idx = STRICT_EQUALS ? (norm === n ? 0 : -1) : norm.indexOf(n);
      if (idx >= 0) { hits.push(`#${i} @${idx}`); foundCounts[i]++; }
    });

    console.log(`  [p${paraIdx}] ${clip(text)}`);
    console.log(`         ↳ norm: ${clip(norm)}`);
    console.log(`         ↳ hits: ${hits.length ? hits.join(", ") : "(none)"}`);
    paraIdx++;
  });
}

function highlightInXmlString(xml: string, needlesNorm: string[], color = RUN_HIGHLIGHT, paraFillHex = PARA_FILL_HEX) {
  const parser = new XMLParser({ ignoreAttributes: false, preserveOrder: false, attributeNamePrefix: "@_" });
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: "@_", suppressBooleanAttributes: false, format: false });
  const root: XmlObj = parser.parse(xml);

  visitParagraphsDeep(root, (para) => {
    const runs = ensureArray(para["w:r"]);
    if (!runs.length) return;

    let paraText = "";
    for (const run of runs) {
      const texts = ensureArray(run["w:t"]);
      for (const t of texts) paraText += typeof t === "string" ? t : (t?.["#text"] ?? "");
    }
    if (!paraText) return;

    let norm = "";
    for (const ch of paraText) {
      const decomp = ch.normalize("NFKD");
      if (/[\p{L}\p{Nd}]/u.test(decomp)) norm += decomp.toLowerCase();
    }

    let matched = false;
    for (const n of needlesNorm) {
      if (!n) continue;
      if (STRICT_EQUALS ? norm === n : norm.indexOf(n) >= 0) { matched = true; break; }
    }
    if (!matched) return;

    for (const run of runs) applyHighlightToRun(run, color, paraFillHex);
    applyParagraphShading(para, paraFillHex);
    para["w:r"] = runs;
  });

  return builder.build(root);
}

async function highlightEverywhereInZip(zip: JSZip, needlesOriginal: string[], color = RUN_HIGHLIGHT, paraFillHex = PARA_FILL_HEX): Promise<number[]> {
  const needlesNorm = needlesOriginal.map(normalizeKeepLettersDigits);
  const foundCounts = new Array(needlesNorm.length).fill(0);

  if (DEBUG) {
    console.log("\n[DEBUG] Normalized needles (%d):", needlesNorm.length);
    needlesOriginal.forEach((n, i) => console.log(`  [${i}] ${n}  →  ${needlesNorm[i]}`));
  }

  const parts = Object.keys(zip.files).filter(p =>
    /^word\/(document\.xml|header\d*\.xml|footer\d*\.xml)$/i.test(p)
  );

  for (const part of parts) {
    const xml = await zip.file(part)!.async("string");
    const label = part.replace(/^word\//, "");
    probePartForNeedles(xml, label, needlesNorm, foundCounts); 
    const newXml = highlightInXmlString(xml, needlesNorm, color, paraFillHex);
    zip.file(part, newXml);
  }

  return foundCounts;
}

export async function highlightItemsPreservingDocx(inputPath: string, items: string[], outputPath: string) {
  const buf = await fs.readFile(inputPath);
  const zip = await JSZip.loadAsync(buf);

  const foundCounts = await highlightEverywhereInZip(zip, items, RUN_HIGHLIGHT, PARA_FILL_HEX);

  const out = await zip.generateAsync({ type: "nodebuffer" });
  await fs.writeFile(outputPath, out);
  return foundCounts;
}

export type NotFoundItem = { index: number; value: string; normalized: string };
export type RunResult = {
  inputPath: string;
  outputPath: string;
  foundCounts: number[];
  notFound: NotFoundItem[];
};

export async function mainHighlightDocx(opts?: {
  input?: string;
  output?: string;
  items?: TopicBlock[];
  log?: boolean;
}): Promise<RunResult> {
  const {
    input = "gtel-1.docx",
    output = "gtel_1_output.docx",
    items = my_items,
    log = true,
  } = opts || {};

  const CWD = process.cwd();
  if (log) console.log("PWD:", CWD);

  const inputPath = path.isAbsolute(input) ? input : path.join(CWD, input);
  const outputPath = path.isAbsolute(output) ? output : path.join(CWD, output);

  if (log) {
    console.log("Input:", inputPath);
    console.log("Output:", outputPath);
  }

  const valuesRaw = toValuesArray(items);
  const values = expandNeedles(valuesRaw);

  const foundCounts = await highlightItemsPreservingDocx(inputPath, values, outputPath);
  if (log) console.log("Wrote:", outputPath);

  const notFound: NotFoundItem[] = [];
  for (let i = 0; i < values.length; i++) {
    if ((foundCounts[i] ?? 0) === 0) {
      notFound.push({ index: i, value: values[i], normalized: normalizeKeepLettersDigits(values[i]) });
    }
  }

  if (log) {
    if (notFound.length) {
      console.log("\n[RESULT] Items NOT found in the Word document (%d):", notFound.length);
      for (const nf of notFound) {
        console.log(`  [${nf.index}] "${nf.value}"`);
        console.log(`       ↳ normalized: ${nf.normalized}`);
      }
    } else {
      console.log("\n[RESULT] All items found at least once 🎉");
    }
  }

  return { inputPath, outputPath, foundCounts, notFound };
}