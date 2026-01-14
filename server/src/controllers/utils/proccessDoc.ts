import * as fs from "fs/promises";
import * as path from "path";
import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

type Item = Record<string, any>;
type TopicDict = Record<string, string | string[]>;

declare const require: NodeRequire;

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

const parser = new DOMParser();
const serializer = new XMLSerializer();

function isEl(n: Node | null, qname: string): n is Element {
  return !!n && n.nodeType === 1 && (n as Element).nodeName === qname;
}

function qn(local: string) {
  return { ns: W_NS, qname: `w:${local}` };
}

function getAttr(el: Element, local: string): string | null {
  if (!el.hasAttributes()) return null;
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes.item(i)!;
    if (a.name === `w:${local}` || a.name === local || a.name.endsWith(`:${local}`)) {
      return a.value;
    }
  }
  return null;
}

function setAttrNS(el: Element, ns: string, qname: string, val: string) {
  el.setAttributeNS(ns, qname, val);
}

function createW(elName: string, doc: Document): Element {
  return doc.createElementNS(W_NS, `w:${elName}`);
}

function* walkElements(node: Node): IterableIterator<Element> {
  if (node.nodeType === 1) yield node as Element;
  for (let c = node.firstChild; c; c = c.nextSibling) yield* walkElements(c);
}

function textOfRun(run: Element): string {
  let out = "";
  for (let n = run.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (n as Element).nodeName === "w:t") {
      out += n.textContent ?? "";
    }
  }
  return out;
}

function ensureRunPr(run: Element, doc: Document): Element {
  for (let c = run.firstChild; c; c = c.nextSibling) {
    if (isEl(c, "w:rPr")) return c;
  }
  const rPr = createW("rPr", doc);
  run.insertBefore(rPr, run.firstChild);
  return rPr;
}

function setRunColor(run: Element, rgbHex = "FF0000", doc: Document) {
  const rPr = ensureRunPr(run, doc);
  let color: Element | null = null;
  for (let c = rPr.firstChild; c; c = c.nextSibling) {
    if (isEl(c, "w:color")) {
      color = c;
      break;
    }
  }
  if (!color) {
    color = createW("color", doc);
    rPr.appendChild(color);
  }
  setAttrNS(color, W_NS, "w:val", rgbHex);
}

function create_dictionary(src_items?: Item[] | null): Record<string, string[]> {
  const items = src_items ?? [];

  function add_value(val: any, out: string[]): void {
    if (typeof val === "string") {
      const s = val.trim();
      if (s) out.push(s);
    } else if (Array.isArray(val) || val instanceof Set) {
      for (const v of val as any[]) add_value(v, out);
    } else if (val && typeof val === "object") {
      for (const [k, v] of Object.entries(val)) {
        if (typeof k === "string" && k.trim().toLowerCase() === "topic") continue;
        add_value(v, out);
      }
    } else if (["number", "boolean"].includes(typeof val)) {
      const s = String(val).trim();
      if (s) out.push(s);
    }
  }

  const result: Record<string, string[]> = {};
  for (const block of items || []) {
    const topic = String((block as any)?.topic ?? "").trim();
    if (!topic) continue;

    const parts: string[] = [];
    for (const [k, v] of Object.entries(block)) {
      if (typeof k === "string" && k.trim().toLowerCase() === "topic") continue;
      add_value(v, parts);
    }

    const seen = new Set<string>();
    const dedup: string[] = [];
    for (const p of parts) {
      if (!seen.has(p)) {
        seen.add(p);
        dedup.push(p);
      }
    }
    result[topic] = dedup;
  }
  return result;
}

function load_topic_dictionary(items?: Item[]): TopicDict {
  for (const mod of ["./dictionary_provider", "./dictionary"]) {
    try {
      const m = require(mod);
      if (m && typeof m.create_dictionary === "function") {
        return m.create_dictionary();
      }
    } catch {
    }
  }
  return create_dictionary(items ?? []);
}

function normalize_text(s: string): string {
  return (s ?? "").trim().toUpperCase();
}

function build_topic_set(items: Item[]): Set<string> {
  const out = new Set<string>();
  for (const blk of items || []) {
    if ((blk as any)?.topic) out.add(normalize_text(String((blk as any).topic)));
  }
  return out;
}

function stripDiacritics(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}+/gu, "");
}
function normalize_for_compare(s: string): string {
  const noDia = stripDiacritics(s || "");
  let out = "";
  for (const ch of Array.from(noDia)) {
    if (/\p{L}/u.test(ch)) out += ch.toLowerCase();
  }
  return out;
}

async function loadXml(zip: JSZip, entry: string): Promise<Document | null> {
  const f = zip.file(entry);
  if (!f) return null;
  const xml = await f.async("string");
  return parser.parseFromString(xml, "application/xml");
}

async function saveXml(zip: JSZip, entry: string, doc: Document) {
  const xml = serializer.serializeToString(doc);
  zip.file(entry, xml);
}

function get_comment_id_to_text(commentsDoc: Document | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!commentsDoc) return map;
  for (const el of walkElements(commentsDoc.documentElement)) {
    if (isEl(el, "w:comment")) {
      const cid = getAttr(el, "id") ?? "";
      let text = "";
      for (const n of walkElements(el)) {
        if (isEl(n, "w:t")) text += n.textContent ?? "";
      }
      map[cid] = (text || "").trim();
    }
  }
  return map;
}

function get_comment_id_to_span_text(docXml: Document): Record<string, string> {
  const accum: Record<string, string[]> = {};
  const active = new Set<string>();

  for (const el of walkElements(docXml.documentElement)) {
    if (isEl(el, "w:commentRangeStart")) {
      const cid = getAttr(el, "id");
      if (cid) {
        active.add(cid);
        if (!accum[cid]) accum[cid] = [];
      }
    } else if (isEl(el, "w:commentRangeEnd")) {
      const cid = getAttr(el, "id");
      if (cid) active.delete(cid);
    } else if (isEl(el, "w:r") && active.size) {
      const t = textOfRun(el);
      if (t) for (const cid of active) accum[cid].push(t);
    } else if (isEl(el, "w:p") && active.size) {
      for (const cid of active) {
        const a = accum[cid];
        if (a.length && !a[a.length - 1].endsWith("\n")) a.push("\n");
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [cid, parts] of Object.entries(accum)) out[cid] = parts.join("").trim();
  return out;
}

function get_comment_ids_in_order(docXml: Document): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const el of walkElements(docXml.documentElement)) {
    if (isEl(el, "w:commentRangeStart")) {
      const cid = getAttr(el, "id");
      if (cid && !seen.has(cid)) {
        ordered.push(cid);
        seen.add(cid);
      }
    }
  }
  return ordered;
}

function compute_matched_ids(
  id_to_text: Record<string, string>,
  topics_norm: Set<string>
): Set<string> | null {
  const matched = new Set<string>();
  for (const [cid, raw] of Object.entries(id_to_text)) {
    const nt = normalize_text(raw);
    if (topics_norm.has(nt)) {
      matched.add(cid);
    } else {
      for (const t of topics_norm) {
        if (nt.includes(t) || t.includes(nt)) {
          matched.add(cid);
          break;
        }
      }
    }
  }
  return matched.size ? matched : null;
}

function color_runs_in_comment_ranges(
  docXml: Document,
  target_ids: Set<string> | null,
  rgbHex: string
) {
  const active = new Set<string>();
  for (const el of walkElements(docXml.documentElement)) {
    if (isEl(el, "w:commentRangeStart")) {
      const cid = getAttr(el, "id");
      if (cid && (!target_ids || target_ids.has(cid))) active.add(cid);
    } else if (isEl(el, "w:commentRangeEnd")) {
      const cid = getAttr(el, "id");
      if (cid) active.delete(cid);
    } else if (isEl(el, "w:r") && active.size) {
      setRunColor(el, rgbHex, docXml);
    }
  }
}

function extract_text_between_topics(
  docXml: Document,
  id_to_text: Record<string, string>,
  start_topic: string,
  end_topic: string
): string {
  const startNorm = normalize_text(start_topic);
  const endNorm = normalize_text(end_topic);

  const startIds = new Set(
    Object.entries(id_to_text)
      .filter(([, t]) => normalize_text(t) === startNorm)
      .map(([id]) => id)
  );
  const endIds = new Set(
    Object.entries(id_to_text)
      .filter(([, t]) => normalize_text(t) === endNorm)
      .map(([id]) => id)
  );
  if (!startIds.size || !endIds.size) return "";

  let collecting = false;
  let startCid: string | null = null;
  const parts: string[] = [];

  for (const el of walkElements(docXml.documentElement)) {
    if (isEl(el, "w:commentRangeStart")) {
      const cid = getAttr(el, "id");
      if (!startCid && cid && startIds.has(cid)) {
        startCid = cid;
        continue;
      }
      if (collecting && cid && endIds.has(cid)) break;
    } else if (isEl(el, "w:commentRangeEnd")) {
      const cid = getAttr(el, "id");
      if (startCid && cid === startCid && !collecting) collecting = true;
    } else if (collecting && isEl(el, "w:r")) {
      const t = textOfRun(el);
      if (t) parts.push(t);
    } else if (collecting && isEl(el, "w:p")) {
      if (parts.length && !parts[parts.length - 1].endsWith("\n")) parts.push("\n");
    }
  }
  return parts.join("").trim();
}

function get_runs_between_topics(
  docXml: Document,
  start_cid: string,
  end_cid?: string | null
): Element[] {
  const runs: Element[] = [];
  let collecting = false;

  for (const el of walkElements(docXml.documentElement)) {
    if (isEl(el, "w:commentRangeEnd")) {
      const cid = getAttr(el, "id");
      if (cid === start_cid) collecting = true;
    } else if (isEl(el, "w:commentRangeStart")) {
      const cid = getAttr(el, "id");
      if (collecting && end_cid && cid === end_cid) break;
    } else if (collecting && isEl(el, "w:r")) {
      runs.push(el);
    }
  }
  return runs;
}

function build_normalized_stream(runs: Element[]) {
  const normChars: string[] = [];
  const positions: Array<[number, number]> = [];

  runs.forEach((r, i) => {
    const txt = textOfRun(r);
    for (let raw = 0; raw < txt.length; raw++) {
      const ch = txt[raw]!;
      const stripped = stripDiacritics(ch);
      for (const base of Array.from(stripped)) {
        if (/\p{L}/u.test(base)) {
          normChars.push(base.toLowerCase());
          positions.push([i, raw]);
        }
      }
    }
  });

  return { normDoc: normChars.join(""), positions };
}

function cloneFirstChildByName(el: Element, qname: string): Element | null {
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (isEl(c, qname)) return (c as Element).cloneNode(true) as Element;
  }
  return null;
}

function new_run_like(ref_run: Element, doc: Document, text: string, colorHex?: string) {
  const run = createW("r", doc);
  const rPr =
    cloneFirstChildByName(ref_run, "w:rPr") ||
    createW("rPr", doc);

  if (colorHex) {
    let color: Element | null = null;
    for (let c = rPr.firstChild; c; c = c.nextSibling) {
      if (isEl(c, "w:color")) {
        color = c;
        break;
      }
    }
    if (!color) {
      color = createW("color", doc);
      rPr.appendChild(color);
    }
    setAttrNS(color, W_NS, "w:val", colorHex);
  }
  run.appendChild(rPr);

  const t = createW("t", doc);
  if (text.startsWith(" ") || text.endsWith(" ")) {
    setAttrNS(t, XML_NS, "xml:space", "preserve");
  }
  t.textContent = text;
  run.appendChild(t);
  return run;
}

function merge_intervals(intervals: Array<[number, number]>) {
  if (!intervals.length) return [] as Array<[number, number]>;
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0].slice() as [number, number]];
  for (const [s, e] of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

function replace_run_with_segments(run: Element, intervals: Array<[number, number]>, rgbHex: string) {
  const full = textOfRun(run);
  if (!full || !intervals.length) return [] as string[];

  const doc = run.ownerDocument!;
  const parent = run.parentNode!;
  const next = run.nextSibling;

  const merged = merge_intervals(intervals);
  const newRuns: Element[] = [];
  const coloredTexts: string[] = [];

  let pos = 0;
  for (const [a0, b0] of merged) {
    const a = Math.max(0, Math.min(a0, full.length));
    const b = Math.max(0, Math.min(b0, full.length - 1));

    if (pos < a) {
      const chunk = full.slice(pos, a);
      if (chunk) newRuns.push(new_run_like(run, doc, chunk));
    }
    const colored = full.slice(a, b + 1);
    if (colored) {
      newRuns.push(new_run_like(run, doc, colored, rgbHex));
      coloredTexts.push(colored);
    }
    pos = b + 1;
  }
  if (pos < full.length) {
    const tail = full.slice(pos);
    if (tail) newRuns.push(new_run_like(run, doc, tail));
  }

  for (const nr of newRuns) parent.insertBefore(nr, next);
  parent.removeChild(run);

  return coloredTexts;
}

function color_phrases_in_region_all(
  docXml: Document,
  start_cid: string,
  end_cid: string | null,
  targets: string[],
  rgbHex = "00AA00"
): boolean {
  const runs = get_runs_between_topics(docXml, start_cid, end_cid || null);
  if (!runs.length) return false;

  const { normDoc, positions } = build_normalized_stream(runs);

  const perRunIntervals = new Map<number, Array<[number, number]>>();

  for (const tRaw of targets) {
    if (tRaw == null) return false;
    const normTarget = normalize_for_compare(String(tRaw));
    if (!normTarget) return false;

    const pos = normDoc.indexOf(normTarget);
    if (pos === -1) return false;

    const byRunIdx = new Map<number, number[]>();
    for (let k = pos; k < pos + normTarget.length; k++) {
      const [runIdx, rawIdx] = positions[k];
      const arr = byRunIdx.get(runIdx) || [];
      arr.push(rawIdx);
      byRunIdx.set(runIdx, arr);
    }
    for (const [runIdx, rawIdxs] of byRunIdx.entries()) {
      const a = Math.min(...rawIdxs);
      const b = Math.max(...rawIdxs);
      const list = perRunIntervals.get(runIdx) || [];
      list.push([a, b]);
      perRunIntervals.set(runIdx, list);
    }
  }

  for (const [runIdx, intervals] of perRunIntervals.entries()) {
    const merged = merge_intervals(intervals);
    replace_run_with_segments(runs[runIdx], merged, rgbHex);
  }

  return true;
}

function color_dictionary_matches(
  docXml: Document,
  ordered_topic_ids: string[],
  id_to_text: Record<string, string>,
  id_to_span: Record<string, string>,
  topic_dict: TopicDict,
  rgbHex = "00B050"
) {
  const dictByKey = new Map<string, string[]>();
  for (const [k, v] of Object.entries(topic_dict || {})) {
    const arr = Array.isArray(v) ? v : [v];
    dictByKey.set(normalize_for_compare(k), arr);
  }

  const n = ordered_topic_ids.length;
  for (let i = 0; i < n; i++) {
    const startCid = ordered_topic_ids[i];
    const endCid = i + 1 < n ? ordered_topic_ids[i + 1] : null;

    const topicLabel = (id_to_span[startCid] || id_to_text[startCid] || "").trim();
    const key = normalize_for_compare(topicLabel);
    const targets = dictByKey.get(key);
    if (!targets || !targets.length) continue;

    const ok = color_phrases_in_region_all(docXml, startCid, endCid, targets, rgbHex);
    if (ok) {
      console.log(`- ${topicLabel}: ✓ all ${targets.length} strings matched and green-marked`);
    } else {
      console.log(`- ${topicLabel}: ✗ not all ${targets.length} strings found; nothing marked`);
    }
  }
}

// printers for the console (debug)
function print_overview(
  topics_norm: Set<string>,
  id_to_text: Record<string, string>,
  id_to_span: Record<string, string>,
  ordered_cids: string[],
  matched_ids: Set<string> | null
) {
  console.log(`Found ${Object.keys(id_to_text).length} comments total.`);

  console.log("\nTopics from items (normalized):");
  for (const t of Array.from(topics_norm).sort()) console.log(`  - ${t}`);

  console.log("\nComments in document order (id -> comment text | visible span):");
  for (const cid of ordered_cids) {
    console.log(`  id ${cid}: ${id_to_text[cid] || ""} | ${id_to_span[cid] || ""}`);
  }

  if (matched_ids) {
    console.log("\nMatched the following comment IDs to topics:");
    for (const cid of [...matched_ids].sort((a, b) => Number(a) - Number(b))) {
      console.log(`  id ${cid}: ${id_to_text[cid]}  |  ${id_to_span[cid] || ""}`);
    }
  } else {
    console.log(
      "\nNo comment text matched any topic (even with loose matching). " +
        "Will treat ALL comments as topic markers for extraction & coloring."
    );
  }
}

function extract_and_print_between_topics(
  docXml: Document,
  ordered_topic_ids: string[],
  id_to_text: Record<string, string>,
  id_to_span: Record<string, string>
) {
  if (ordered_topic_ids.length < 2) {
    console.log("\nNot enough topic markers found to extract between-topic text.");
    return;
  }
  for (let i = 0; i < ordered_topic_ids.length - 1; i++) {
    const startCid = ordered_topic_ids[i];
    const endCid = ordered_topic_ids[i + 1];
    const startComment = id_to_text[startCid] || "";
    const endComment = id_to_text[endCid] || "";

    const segment = extract_text_between_topics(docXml, id_to_text, startComment, endComment);

    const startLabel = id_to_span[startCid] || startComment || `#${startCid}`;
    const endLabel = id_to_span[endCid] || endComment || `#${endCid}`;

    console.log(`\n=== ${startLabel} → ${endLabel} ===`);
    console.log(segment || "[No text between these topics]");
  }
}

export async function processDoc(
  file_in: string,
  file_out: string,
  items: Item[],
  blackColor = "FF0000" // black
) {
  const topics_norm = build_topic_set(items);

  const inBuf = await fs.readFile(file_in);
  const zip = await JSZip.loadAsync(inBuf);

  const docXml = await loadXml(zip, "word/document.xml");
  if (!docXml) throw new Error("word/document.xml not found");
  const commentsXml = await loadXml(zip, "word/comments.xml");

  const id_to_text = get_comment_id_to_text(commentsXml);
  const id_to_span = get_comment_id_to_span_text(docXml);
  const ordered_cids = get_comment_ids_in_order(docXml);

  const matched_ids = compute_matched_ids(id_to_text, topics_norm);
  print_overview(topics_norm, id_to_text, id_to_span, ordered_cids, matched_ids);

  const ordered_topic_ids =
    matched_ids === null
      ? ordered_cids
      : ordered_cids.filter((cid) => matched_ids.has(cid));

  extract_and_print_between_topics(docXml, ordered_topic_ids, id_to_text, id_to_span);
  // color the topic
  color_runs_in_comment_ranges(docXml, matched_ids, blackColor);

  const topic_dict = load_topic_dictionary(items);
  color_dictionary_matches(
    docXml,
    ordered_topic_ids,
    id_to_text,
    id_to_span,
    topic_dict,
    "00B050"
  );

  await saveXml(zip, "word/document.xml", docXml);
  const outBuf = await zip.generateAsync({ type: "nodebuffer" });
  await fs.writeFile(file_out, outBuf);
  console.log(`\nSaved: ${file_out}`);
}

if (typeof require !== "undefined" && require.main === module) {
  (async () => {
    const [, , inDoc, outDoc, itemsJson] = process.argv;
    if (!inDoc || !outDoc || !itemsJson) {
      console.error("Usage: node processDoc.js <in.docx> <out.docx> <items.json>");
      process.exit(1);
    }
    const items: Item[] = JSON.parse(await fs.readFile(path.resolve(itemsJson), "utf8"));
    await processDoc(inDoc, outDoc, items, "FF0000");
  })().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}