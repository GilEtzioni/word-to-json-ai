import { PathLike } from "fs";
import type { PathLike as _PathLike } from "fs";

type StringDict = Record<string, string>;
type TopicsInput = string[] | string;
type SplitByTopicsResult = { topics: Array<{ topic: string; text: string }> };
type ContentInput = StringDict | TopicsInput | SplitByTopicsResult;

let secondController: any = null;
try {
  secondController = require("./secondController");
} catch {
  secondController = null;
}

export const ALLOWED_FIELDS = new Set<string>([
  "Question",
  "Answer",
  "שאלות לדוגמה",
  "התשובה",
  "examples_included",
  "url_included",
  "Topoic",
  "Title",
  "Description",
]);

export const LABEL_SYNONYMS: Record<string, string> = {
  // flags
  "examples_url_included": "url_included",
  "examples-url-included": "url_included",
  "examples url included": "url_included",
  "url included": "url_included",

  // he/typos
  "שאלות לדוגמא": "שאלות לדוגמה",
  "תשובה": "התשובה",

  // english case-insensitive
  "question": "Question",
  "answer": "Answer",
  "examples included": "examples_included",
};

const _KEYLIKE_SEP = String.raw`[:：;；]`;

function dedupInOrder(items: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

function canon(label: string): string {
  const raw = (label || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/:$/, "")
    .trim();

  if (!raw) return "";

  const low = raw.toLowerCase();
  if (LABEL_SYNONYMS[low]) return LABEL_SYNONYMS[low];

  if (LABEL_SYNONYMS[raw]) return LABEL_SYNONYMS[raw];

  return raw;
}

export const USE_OPENAI = true;

function deriveAllowedFromInstructions(
  baseAllowed: Set<string>,
  json_instructions?: string | null
): { allowedSet: Set<string>; restricted: boolean; explicitList: string[] } {
  const allowed = new Set<string>([...baseAllowed]);
  if (!json_instructions || !json_instructions.trim()) {
    return { allowedSet: allowed, restricted: false, explicitList: [...allowed] };
  }

  const instr = json_instructions.trim();
  const lower = instr.toLowerCase();

  const isOnly =
    /\bonly\b|\bexclusive(ly)?\b|\bexact(ly)?\b|\bthese fields only\b/.test(lower) ||
    /רק השדות|אך ורק השדות|בלבד/.test(instr);

  const quoted = [...instr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  const afterWords = [
    ...instr
      .split(/fields?|labels?|שדות|תגיות|שמות שדות/i)
      .slice(1)
      .map((chunk) => chunk)
  ].join(" ");

  const commaish = quoted.length
    ? quoted
    : afterWords
        .split(/[\n,;]+|(?:\s+and\s+)|(?:\s+ו\s+)/i)
        .map((s) => s.trim())
        .filter(Boolean);

  const wordish = [...instr.matchAll(/([\p{L}\p{N}_\-]+)\s*(?=,|\.|\s|$)/gu)]
    .map((m) => m[1])
    .filter(Boolean);

  const rawCandidates = dedupInOrder([...commaish, ...quoted, ...wordish])
    .map((s) => s.trim())
    .filter(Boolean);

  const stop = new Set(
    ["you","need","to","find","the","this","that","only","fields","field","labels","label",
     "are","is","with","and","or","also","include","included","age?","tall?",
     "רק","שדות","שדה","בלבד","כולל","הם","לעשות","צריך","למצוא","האלה","האלו","עם","וגם","או"]
  );
  const candidates = rawCandidates
    .map((x) => x.replace(/[.“”'",:;]+$/g, "").replace(/^[.“”'",:;]+/g, ""))
    .filter((x) => x && !stop.has(x.toLowerCase()))
    .map(canon)
    .filter(Boolean);

  const explicitList = dedupInOrder(candidates);

  if (explicitList.length === 0) {
    return { allowedSet: allowed, restricted: false, explicitList: [...allowed] };
  }

  if (isOnly) {
    return { allowedSet: new Set<string>(explicitList), restricted: true, explicitList };
  }

  for (const c of explicitList) allowed.add(c);
  return { allowedSet: allowed, restricted: false, explicitList: [...allowed] };
}

function buildSystemPrompt(
  userInstructions: string | null | undefined,
    candidateAllowed: string[],
): string {
  const instr = (userInstructions || "").trim();

const base = `
Extract labels and types from the text.
VALID TYPES: [string, string[], bool, bool[], number, number[]]

Output ONLY a JSON array of strings in this EXACT format:
["'Label': type", "'Label': type"]

Example: ["'Question': string[]", "'Answer': string"]
`.trim();

  if (!instr) {
    return base + `\nSELECTION: Prefer labels from the CANDIDATE LABELS list.`;
  }

  return base + `\nUSER INSTRUCTIONS:\n"${instr}"\n\nSELECTION: Obey USER INSTRUCTIONS strictly.`;
}

async function completeWithOpenAI(systemPrompt: string, userText: string, modelName: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI call failed. Ensure OPENAI_API_KEY is set.");
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_API_BASE || undefined,
  });

  try {
    const resp = await client.responses.create({
      model: modelName,
      temperature: 0,
      // max_output_tokens: 400,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    });

    const text: string =
      (resp as any).output_text ??
      (() => {
        const out = (resp?.output ?? []) as any[];
        const parts: string[] = [];
        for (const item of out) {
          if (typeof item === "string") parts.push(item);
          else if (item?.content && Array.isArray(item.content)) {
            for (const p of item.content) {
              if (typeof p?.text === "string") parts.push(p.text);
            }
          }
        }
        return parts.join("\n");
      })() ??
      "";

    return (text || "").trim();
  } catch (err) {
    try {
      const openaiLegacy = require("openai");
      const legacyClient = new openaiLegacy.OpenAI({
        apiKey,
        baseURL: process.env.OPENAI_API_BASE || undefined,
      });

      const chat = await legacyClient.chat.completions.create({
        model: modelName,
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
      });

      return (chat.choices?.[0]?.message?.content || "").trim();
    } catch (e: any) {
      throw new Error(`OpenAI call failed. Ensure OPENAI_API_KEY is set. Details: ${e?.message || e}`);
    }
  }
}

function coerceJsonArray(s: string): string[] {
  let str = (s || "").trim();

  try {
    const data = JSON.parse(str);
    if (Array.isArray(data)) return data.map((x) => String(x));
  } catch {
  }

  const m = str.match(/\[.*\]/s);
  if (m) {
    try {
      const data = JSON.parse(m[0]);
      if (Array.isArray(data)) return data.map((x) => String(x));
    } catch {
    }
  }

  const quoted = [...str.matchAll(/"([^"]+)"/g)].map((mm) => mm[1]);
  return quoted;
}

function scanAllowedLabels(text: string, allowedSet: Set<string>): string[] {
  const found: string[] = [];

  for (const ln of text.split(/\r?\n/)) {
    const raw = ln.trim();
    if (!raw) continue;
    const re = new RegExp(String.raw`^(?:#{1,6}\s+|#\s+)?(.+?)\s*${_KEYLIKE_SEP}.*$`);
    const m = raw.match(re);
    if (!m) continue;

    const label = m[1]?.trim() ?? "";
    const cand = canon(label);
    if (!cand) continue;

  if (allowedSet.has(cand)) {
      found.push(`${cand}: string`);
    }
  }

  return dedupInOrder(found);
}

function ensureContentDict(
  maybeTopicsOrDict: ContentInput,
  srcPath?: string | PathLike | null
): StringDict {
  if (
    typeof maybeTopicsOrDict === "object" &&
    maybeTopicsOrDict !== null &&
    !Array.isArray(maybeTopicsOrDict) &&
    "topics" in maybeTopicsOrDict &&
    Array.isArray((maybeTopicsOrDict as any).topics)
  ) {
    const arr = (maybeTopicsOrDict as any).topics as Array<{ topic: string; text: string }>;
    const dict: StringDict = {};

    for (let i = 0; i < arr.length; i++) {
      const topic = String(arr[i]?.topic ?? "").trim();
      const text = String(arr[i]?.text ?? "");

      if (!topic) continue;

      const key = dict[topic] === undefined ? topic : `${topic}__${i + 1}`;
      dict[key] = text;
    }

    return dict;
  }

  if (typeof maybeTopicsOrDict === "object" && !Array.isArray(maybeTopicsOrDict)) {
    return maybeTopicsOrDict as StringDict;
  }

  if (!srcPath) {
    throw new Error(
      "find_all_fields: when passing topics, also provide 'path' to rebuild content via secondController."
    );
  }
  if (!secondController || typeof secondController.process_document !== "function") {
    throw new Error("secondController import failed; pass a content dict instead.");
  }
  return secondController.process_document(srcPath, maybeTopicsOrDict);
}

export async function find_all_fields(
  topics_or_content: ContentInput,
  opts?: {
    path?: string | PathLike | null;
    model?: string | null;
    useOpenAI?: boolean;
    json_instructions?: string | null;
  }
): Promise<{ field: string; type: string }[]> {

  const {
    path: srcPath = null,
    model = null,
    useOpenAI = USE_OPENAI,
    json_instructions = null,
  } = opts ?? {};

  const contentDict = ensureContentDict(topics_or_content, srcPath);

  const parts: string[] = [];
  for (const [topic, content] of Object.entries(contentDict)) {
    if (content && content.trim()) {
      parts.push(`### ${topic}\n${content}`);
    }
  }
  const bigBlob = parts.join("\n\n");
  const { allowedSet, restricted, explicitList } = deriveAllowedFromInstructions(ALLOWED_FIELDS, json_instructions);
  const labels = scanAllowedLabels(bigBlob, allowedSet);

  if (useOpenAI && process.env.OPENAI_API_KEY) {
      const modelName = model || process.env.OPENAI_API_MODEL || "gpt-4o-mini";
      const systemPrompt = buildSystemPrompt(json_instructions, [...allowedSet]);
      const out = await completeWithOpenAI(systemPrompt, bigBlob, modelName);
      
      const llmLabels = coerceJsonArray(out); 
      const finalFormatted: { field: string; type: string }[] = [];

      for (const rawEntry of llmLabels) {
        const parts = rawEntry.split(':');
        const fieldPart = parts[0].replace(/'/g, "").trim();
        const typePart = (parts[1] || 'string').trim();
        const cleanedField = canon(fieldPart);

        if (allowedSet.has(cleanedField)) {
          finalFormatted.push({ field: fieldPart, type: typePart });
        }
      }
      return finalFormatted;
  }

  const final = dedupInOrder(labels);
    const resultStrings = restricted ? final.filter((x) => allowedSet.has(x)) : final;

    return resultStrings.map(s => {
      const [f, t] = s.split(':');
      return {
        field: (f || "").replace(/'/g, "").trim(),
        type: (t || "string").trim()
      };
    });
  }


if (require.main === module) {
  const yargs = require("yargs/yargs");
  const { hideBin } = require("yargs/helpers");

  (async () => {
    const argv = yargs(hideBin(process.argv))
      .option("path", { type: "string", demandOption: false })
      .option("topics", { type: "string", demandOption: false, default: "" })
      .option("model", { type: "string", demandOption: false })
      .option("json_instructions", { type: "string", demandOption: false })
      .help(false)
      .version(false).argv as { path?: string; topics?: string; model?: string; json_instructions?: string };
    const { path: srcPath, topics, model, json_instructions } = argv;

    const opts = { path: srcPath || null, model: model || null, json_instructions: json_instructions ?? null };

    let fields: { field: string; type: string }[] = [];
    if (topics && topics.trim()) {
      let topicsOrContent: ContentInput;
      try {
        topicsOrContent = JSON.parse(topics);
      } catch {
        topicsOrContent = topics
          .split(/\r?\n/)
          .map((ln) => ln.trim())
          .filter(Boolean);
      }
      fields = await find_all_fields(topicsOrContent, opts);
    } else {
      const raw = await new Promise<string>((resolve) => {
        let buf = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", (chunk) => (buf += chunk));
        process.stdin.on("end", () => resolve(buf));
      });
      const topicsOrContent = JSON.parse(raw) as StringDict;
      fields = await find_all_fields(topicsOrContent, opts);
    }

    process.stdout.write(JSON.stringify(fields, null, 0) + "\n");
  })().catch((e: any) => {
    console.error(e?.stack || e?.message || e);
    process.exit(1);
  });
}