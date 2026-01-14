import dotenv from "dotenv";
import util from "node:util";
import fs from "fs";
import path from "path";

dotenv.config();

export type ExtractedValue = string | boolean | number | null | (string | boolean | number)[];
export type ExtractedItem = Record<string, ExtractedValue>;
export interface TopicItems {
  topic: string;
  items: ExtractedItem[];
}

export type BlockDescription = { blockId: number; description: string };
export type ContentTopic = {
  topic: string;
  blocksDescription: BlockDescription[];
  text: string;
};
export type ContentDict = { topics: ContentTopic[] };

type Line = {
  id: number;
  text: string;
  blockId?: number;
};

export async function process_document(
  content_dict: ContentDict,
  fields: { field: string; type: string }[] | string,
  comments?: string
): Promise<TopicItems[]> {
  const wantedRaw = ensureFieldsList(fields as any);
  
  const fieldTypeMap = new Map<string, string>(
    Array.isArray(fields) ? fields.map(f => [f.field, f.type]) : []
  );
  
  const wanted = Array.isArray(fields) ? fields.map(f => f.field) : wantedRaw;

  if (!content_dict || typeof content_dict !== "object" || !wanted.length) return [];

  const topicsArr = Array.isArray((content_dict as any).topics)
    ? ((content_dict as any).topics as ContentTopic[])
    : [];

  if (!topicsArr.length) return [];

  const wantedMap = buildWantedMap(wanted);

  const itemsPerTopic: TopicItems[] = [];
  for (const t of topicsArr) {
    const topic = String(t?.topic ?? "");
    const text = String(t?.text ?? "");
    const blocksDescription = Array.isArray(t?.blocksDescription) ? t.blocksDescription : [];

    const lines = splitTextToNumberedLinesWithBlockId(text);

    const idToText = new Map<number, string>(lines.map((l) => [l.id, l.text]));

    const llmObj = await llmLabelLinesForTopic(
      topic,
      lines,
      wanted,
      blocksDescription,
      comments
    );
    const arr = pickArrayFromLLM(llmObj);

    const clean: ExtractedItem[] = [];
    for (const it of arr) {
      if (!it || typeof it !== "object") continue;

      const rebuilt = rebuildItemFromLineIds(
        it as Record<string, unknown>,
        wantedMap,
        idToText,
        fieldTypeMap
      );

      if (Object.keys(rebuilt).length > 0) clean.push(rebuilt);
    }

    itemsPerTopic.push({ topic, items: clean });
  }

  return itemsPerTopic;
}

export const SYSTEM_PROMPT = `
You are a fields labeling agent.

You receive:
- "topic"
- "fields" (allowed keys)
- "blocksDescription": array of objects:
    { blockId, description }
  Notes:
  - blockId refers to the <block_N> tags in the text. "description" explains the formatting style.
- "additional_instructions" (optional): extra constraints from the user. If provided, you MUST follow them.
- "lines": array of objects:
    { id, text, blockId }
  Notes:
  - "text" is the actual content split into lines (newlines preserved)
  - "blockId" (if present) indicates which <block_N> the line came from.

Return ONLY a JSON object with this exact schema:

{
  "items": [
    {
      /* one object per found item */
      /* keys MUST be taken from "fields" exactly (case-sensitive) */
      /* values MUST be either:
          - an array of line IDs (numbers) for that field, in correct order, OR
          - true/false (only if clearly boolean), OR
          - null (if missing)
      */
    }
  ]
}

Strict rules:
- Use EXACTLY the field names provided in "fields" (case-sensitive) as keys.
- If "additional_instructions" are provided, you MUST follow them strictly.
- NEVER invent line IDs. Only use IDs that appear in "lines".
- Do NOT copy the text into the output. Only reference line IDs.
- If no items are found, return: {"none":[]}
- Output ONLY the JSON object. No prose, no code fences.
`.trim();

async function llmLabelLinesForTopic(
  topic: string,
  lines: Line[],
  fields: string[],
  blocksDescription: BlockDescription[],
  comments?: string
): Promise<any> {
  const userObj: any = {
    fields: Array.isArray(fields) ? fields : fields,
    topic,
    blocksDescription,
    lines,
    instruction:
      "Return ONLY line-id arrays per field. Do NOT output the text itself. Use blocksDescription and blockId hints to infer field boundaries.",
  };

  if (typeof comments === "string" && comments.trim() !== "") {
    userObj.additional_instructions = comments.trim();
  }

  const respText = await openaiCompleteJson(SYSTEM_PROMPT, JSON.stringify(userObj));
  return parseJsonObject(respText);
}

async function openaiCompleteJson(
  systemPrompt: string,
  userJson: string,
  retries = 2
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const model = process.env.OPENAI_API_MODEL || "gpt-4o";
  const baseURL = process.env.OPENAI_API_BASE || undefined;

  const userContent = `json\n${userJson}`;

  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      try {
        const OpenAI = (await import("openai")).default as any;
        const client = new OpenAI({ apiKey, baseURL });

        const resp = await client.responses.create({
          model,
          instructions: systemPrompt,
          input: [{ role: "user", content: userContent }],
          temperature: 0,
          max_output_tokens: 20000,
          text: { format: { type: "json_object" } },
        });

        const out =
          (resp?.output_text ?? "").toString().trim() ||
          extractOutputTextFromResponses(resp);

        if (!out) throw new Error("Empty response from Responses API");
        return out;
      } catch {
        const url = `${baseURL ?? "https://api.openai.com/v1"}/responses`;

        const body: any = {
          model,
          instructions: systemPrompt,
          input: [{ role: "user", content: userContent }],
          temperature: 0,
          max_output_tokens: 2000,
          text: { format: { type: "json_object" } },
        };

        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          throw new Error(`OpenAI call failed: ${resp.status} ${resp.statusText} ${txt}`);
        }

        const data: any = await resp.json();
        const out =
          (data?.output_text ?? "").toString().trim() ||
          extractOutputTextFromResponses(data);

        if (!out) throw new Error("Empty response from Responses API");
        return out;
      }
    } catch (e) {
      lastErr = e;
      if (attempt < retries) {
        await sleep(700);
        continue;
      }
    }
  }

  throw new Error(`OpenAI call failed: ${String(lastErr)}`);
}

function extractOutputTextFromResponses(resp: any): string {
  const output = resp?.output;
  if (!Array.isArray(output)) return "";

  const parts: string[] = [];
  for (const item of output) {
    if (item?.type !== "message") continue;
    const content = item?.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === "output_text" && typeof c?.text === "string") {
        parts.push(c.text);
      }
    }
  }
  return parts.join("").trim();
}

function splitTextToNumberedLinesWithBlockId(text: string): Line[] {
  const normalized = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ");

  const blockRe = /<block_(\d+)>([\s\S]*?)<\/block_\1>/g;

  const lines: Line[] = [];
  let id = 1;
  let lastEnd = 0;

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(normalized)) !== null) {
    const gap = normalized.slice(lastEnd, m.index);
    pushPlainLines(gap);

    const blockId = Number(m[1]);
    const inner = String(m[2] ?? "");

    const parts = inner.split("\n");
    for (const part of parts) {
      const keep = part.replace(/\s+$/g, "");
      if (!keep.trim()) continue;
      lines.push({ id: id++, text: keep, blockId });
    }

    lastEnd = blockRe.lastIndex;
  }

  pushPlainLines(normalized.slice(lastEnd));
  return lines;

  function pushPlainLines(chunk: string) {
    const rawLines = String(chunk ?? "").split("\n");
    for (const ln of rawLines) {
      const keep = ln.replace(/\s+$/g, "");
      if (!keep.trim()) continue;
      lines.push({ id: id++, text: keep });
    }
  }
}

function rebuildItemFromLineIds(
  it: Record<string, unknown>,
  wantedMap: Map<string, string>,
  idToText: Map<number, string>,
  fieldTypeMap: Map<string, string>
): ExtractedItem {
  const out: ExtractedItem = {};

  for (const rawKey of Object.keys(it)) {
    const norm = normalizeKey(rawKey);
    const target = wantedMap.get(norm);
    if (!target) continue;

    const v = it[rawKey];

    if (typeof v === "boolean") {
      out[target] = v;
      continue;
    }
    if (v == null) {
      out[target] = null;
      continue;
    }

    const ids = coerceToIdArray(v);
    if (ids && ids.length) {
      const fieldType = fieldTypeMap.get(target) || 'string';
      const textLines = ids
        .map((id) => idToText.get(id))
        .filter((s): s is string => typeof s === "string" && s.length > 0);

      if (fieldType.endsWith('[]')) {
        out[target] = textLines.map(ln => normalizePreserveNewlines(ln));
      } else {
        const joined = textLines.join("\n");
        out[target] = joined ? normalizePreserveNewlines(joined) : null;
      }
      continue;
    }

    if (typeof v === "string") {
      out[target] = normalizePreserveNewlines(v);
    } else if (typeof v === "number") {
      out[target] = String(v);
    } else {
      try {
        out[target] = normalizePreserveNewlines(JSON.stringify(v));
      } catch {
        out[target] = null;
      }
    }
  }

  return out;
}

function coerceToIdArray(v: unknown): number[] | null {
  if (Array.isArray(v)) {
    const ids = v
      .map((x) => (typeof x === "number" ? x : parseInt(String(x), 10)))
      .filter((n) => Number.isFinite(n) && n > 0);
    return ids.length ? uniqueKeepOrder(ids) : null;
  }

  if (typeof v === "number" && Number.isFinite(v) && v > 0) return [v];

  if (typeof v === "string") {
    const nums = [...v.matchAll(/\d+/g)]
      .map((m) => parseInt(m[0], 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    return nums.length ? uniqueKeepOrder(nums) : null;
  }

  return null;
}

function uniqueKeepOrder(nums: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of nums) {
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function parseJsonObject(s: string): any {
  if (typeof s !== "string") return {};
  const t = stripCodeFences(s).trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}$/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return {};
      }
    }
    return {};
  }
}

function pickArrayFromLLM(obj: any): any[] {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  if (typeof obj !== "object") return [];
  if (Array.isArray((obj as any).items)) return (obj as any).items;
  if (Array.isArray((obj as any).qa)) return (obj as any).qa;
  if (Array.isArray((obj as any).none)) return [];
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) return v;
  }
  return [];
}

function ensureFieldsList(fields: any): string[] {
  if (Array.isArray(fields)) {
    return fields.map(f => (typeof f === 'object' ? f.field : String(f))).filter(Boolean);
  }

  const txt = String(fields ?? "").trim();

  try {
    const parsed = JSON.parse(txt);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}

  const quoted = [...txt.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (quoted.length) return quoted;

  if (txt.includes(",")) return txt.split(",").map((s) => s.trim()).filter(Boolean);

  return txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

function buildWantedMap(fields: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of fields) {
    const exact = String(f);
    const norm = normalizeKey(exact);
    if (!norm) continue;
    if (!m.has(norm)) m.set(norm, exact);
  }
  return m;
}

function normalizeKey(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function normalizePreserveNewlines(s: string): string {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .trim();
}

function stripCodeFences(s: string): string {
  if (!s.startsWith("```")) return s;
  let out = s.replace(/^```(?:json)?\s*/i, "");
  out = out.replace(/```$/i, "");
  return out.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export function printItems(items: TopicItems[]) {
  console.log(
    util.inspect(items, {
      depth: null,
      colors: true,
      maxArrayLength: null,
      breakLength: 120,
      compact: false,
    })
  );
}

export async function saveItemsAsTs(items: any[], outputDir: string, originalFileName: string) {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeName = originalFileName.replace(path.extname(originalFileName), "").replace(/[^a-z0-9]/gi, "_");
    const filePath = path.join(outputDir, `${safeName}_items.ts`);
    const jsonString = JSON.stringify(items, null, 2);

    const tsFormattedString = jsonString.replace(/"((?:[^"\\]|\\.)*)"/g, (match) => {
      if (match.includes('\\n')) {
        try {
          const raw = JSON.parse(match);
          const safeRaw = raw
            .replace(/`/g, '\\`') 
            .replace(/\$\{/g, '\\${');
          return `\`${safeRaw}\``;
        } catch (e) {
          return match;
        }
      }
      return match;
    });

    const fileContent = `export const items = ${tsFormattedString};`;

    fs.writeFileSync(filePath, fileContent);
  } catch (error) {
    console.error("❌ Error saving items:", error);
  }
}