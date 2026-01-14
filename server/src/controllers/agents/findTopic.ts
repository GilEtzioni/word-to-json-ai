import dotenv from "dotenv";
dotenv.config();
import { load_document_text } from "../utils/extractor";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

export type TopicWithId = {
  topic: string;
  id: number | null;
};

export const SYSTEM_PROMPT = `
You extract ALL topic headings from a document and return them as a JSON array of objects.

Each object MUST be: {"topic": string, "id": number|null}

How to detect headings (HIGH RECALL):
- VERY STRONG SIGNAL: text wrapped in <block_N> tags (may include attributes) that appears with larger font than all the other text.
- VERY STRONG SIGNAL: text that is bold AND underlined.

ID rule:
- Block tags may include attributes, e.g. <block_12 fs="20" b="0" u="0" c="#000000"> ... </block_12>.
- If the heading came from inside ANY <block_N ...>...</block_N>, you MUST set id = N (number).
- If it did NOT come from a <block_N> tag, set id = null.

Topic text rules:
- Preserve original wording exactly.
  for example, "Introduction-to AI" remains "Introduction-to AI".
- Remove ONLY leading numbering/bullets (e.g., "1. ", "2.1 ", "- ", "• ").
- Remove formatting tags like <block_N ...> or </block_N> from the topic field.

Exclusion:
- Ignore headers/footers, boilerplate, and table of contents.

Output:
- Output ONLY a single-line compact JSON array of objects. No extra text.
`.trim();

function buildMessages(
  systemPrompt: string,
  userText: string,
  topicInstructions?: string
) {
  const msgs: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  if (topicInstructions && topicInstructions.trim().length > 0) {
    msgs.push({
      role: "system",
      content:
        `Additional operator instructions (from UI):\n` +
        `${topicInstructions.trim()}\n\n` +
        `If these contradict the general policy, follow these instructions.`,
    });
  }

  msgs.push({ role: "user", content: userText });
  return msgs;
}

async function completeWithOpenAI(
  systemPrompt: string,
  userText: string,
  modelName: string,
  topicInstructions?: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_API_BASE || undefined;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const messages = buildMessages(systemPrompt, userText, topicInstructions);

  try {
    const OpenAI = (await import("openai")).default as any;
    const client = new OpenAI({ apiKey, baseURL });
    const resp = await client.chat.completions.create({
      model: modelName,
      temperature: 0,
      messages,
    });
    return resp?.choices?.[0]?.message?.content?.toString().trim() ?? "";
  } catch {
    const url = `${baseURL ?? "https://api.openai.com/v1"}/chat/completions`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: modelName, temperature: 0, messages }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OpenAI call failed: ${resp.status} ${text}`);
    }

    const data: any = await resp.json();
    return data?.choices?.[0]?.message?.content?.toString().trim() ?? "";
  }
}

function normalizeTopicText(s: string): string {
  let out = (s ?? "").toString().trim();
  // remove <block_12 ...> and </block_12>
  out = out.replace(/<\/?block_\d+(?:\s[^>]*)?>/g, "").trim();
  // remove bullets
  out = out.replace(/^[\-\u2022\*]+/, "").trim();
  // remove leading numbering like 1. or 2.1 etc
  out = out.replace(/^\d+(?:\.\d+)*\s+/, "").trim();
  // remove wrapping quotes
  out = out.replace(/^['"]+|['"]+$/g, "").trim();
  return out;
}

function buildBlockTextToIdMap(text: string): Map<string, number> {
  const map = new Map<string, number>();
  const re = /<block_(\d+)\b[^>]*>([\s\S]*?)<\/block_\1>/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = Number(m[1]);
    const inner = m[2] ?? "";
    const key = normalizeTopicText(inner).toLowerCase();
    if (key && !map.has(key)) map.set(key, id);
  }

  return map;
}

function parseTopics(raw: string): TopicWithId[] {
  if (!raw) return [];

  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  const slice = start >= 0 && end >= start ? raw.slice(start, end + 1) : raw;

  try {
    const parsed = JSON.parse(slice);
    if (!Array.isArray(parsed)) return [];

    const mapped: TopicWithId[] = parsed
      .map((x: any) => {
        const topic = normalizeTopicText(String(x?.topic ?? ""));

        const idRaw = x?.id;
        let id: number | null = null;

        if (typeof idRaw === "number") {
          id = idRaw;
        } else if (typeof idRaw === "string") {
          const s = idRaw.trim();
          const m = s.match(/\d+/);
          id = m ? Number(m[0]) : null;
        }

        return {
          topic,
          id: Number.isFinite(id as number) ? (id as number) : null,
        };
      })
      .filter((t) => t.topic.length > 0);

    const seen = new Set<string>();
    const out: TopicWithId[] = [];
    for (const t of mapped) {
      const key = t.id !== null ? `id:${t.id}` : `t:${t.topic.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }

    return out;
  } catch {
    return [];
  }
}

async function bufferToTempDocxPath(buf: Buffer): Promise<string> {
  const name = `docx_${
    crypto.randomUUID?.() ?? crypto.randomBytes(16).toString("hex")
  }.docx`;
  const p = path.join(os.tmpdir(), name);
  await fs.writeFile(p, buf);
  return p;
}

export async function extract_topics(
  input: string | Buffer,
  topic_instructions?: string,
  model?: string,
  dump_text?: true
): Promise<string>;
export async function extract_topics(
  input: string | Buffer,
  topic_instructions?: string,
  model?: string,
  dump_text?: false
): Promise<TopicWithId[]>;
export async function extract_topics(
  input: string | Buffer,
  topic_instructions?: string,
  model?: string,
  dump_text = false
): Promise<string | TopicWithId[]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  let tempPath: string | null = null;

  try {
    let text = "";

    if (Buffer.isBuffer(input)) {
      tempPath = await bufferToTempDocxPath(input);
      text = ((await load_document_text(tempPath)) ?? "").trim();
    } else {
      const isFilePath = /\.(pdf|docx|txt)$/i.test(input);
      text = isFilePath
        ? ((await load_document_text(input)) ?? "").trim()
        : (input ?? "").trim();
    }

    if (dump_text) return text;
    if (!text.trim()) return [];

    const blockMap = buildBlockTextToIdMap(text);

    const modelName = model || process.env.OPENAI_API_MODEL || "gpt-4o-mini";
    const raw = await completeWithOpenAI(
      SYSTEM_PROMPT,
      text,
      modelName,
      topic_instructions?.trim() ? topic_instructions : undefined
    );

    const topics = parseTopics(raw);

    for (const t of topics) {
      if (t.id === null) {
        const hit = blockMap.get(t.topic.toLowerCase());
        if (hit != null) t.id = hit;
      }
    }

    return topics;
  } finally {
    if (tempPath) {
      try {
        await fs.unlink(tempPath);
      } catch {
      }
    }
  }
}