import util from "node:util";
import path from "path";
import fs from "fs";

export type TopicWithId = {
  topic: string;
  id: number;
};

export type BlockDescription = { blockId: number; description: string };

export type SplitByTopicsResult = {
  topics: Array<{
    topic: string;
    blocksDescription: BlockDescription[];
    text: string;
  }>;
};

type Options = {
  keepBlockWrappers?: boolean;
  mergeConsecutiveSameBlocks?: boolean;
};

function parseTopicsJson(topics: unknown): TopicWithId[] {
  if (Array.isArray(topics)) {
    return (topics as any[])
      .map((t) => ({ topic: String(t?.topic ?? ""), id: Number(t?.id) }))
      .filter((t) => t.topic.length > 0 && Number.isFinite(t.id));
  }

  const txt = String(topics ?? "").trim();
  return parseTopicsJson(JSON.parse(txt));
}

function parseAttrs(attrsChunk: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrsChunk)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

function normBool(v: string | undefined): "1" | "0" {
  if (v == null) return "0";
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" ? "1" : "0";
}

function normNum(v: string | undefined): string {
  if (v == null) return "";
  const s = v.trim();
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

function normColor(v: string | undefined): string {
  return (v ?? "").trim().toUpperCase();
}

function styleKeyFromAttrs(attrs: Record<string, string>): string {
  const fs = normNum(attrs["fs"]);
  const b = normBool(attrs["b"]);
  const u = normBool(attrs["u"]);
  const c = normColor(attrs["c"]);
  return `fs=${fs}|b=${b}|u=${u}|c=${c}`;
}

function describeAttrs(attrs: Record<string, string>): string {
  const fs = normNum(attrs["fs"]) || "?";
  const b = normBool(attrs["b"]) === "1";
  const u = normBool(attrs["u"]) === "1";
  const c = normColor(attrs["c"]) || "?";
  return `fs=${fs}, bold=${b}, underline=${u}, color=${c}`;
}

function mergeConsecutiveSameBlockIds(input: string): string {
  const re = /<\/block_(\d+)>(\s*)<block_\1>/g;

  let out = input;
  let prev: string;
  do {
    prev = out;
    out = out.replace(re, (_match, _id, ws) => ws);
  } while (out !== prev);

  return out;
}

function normalizeBlocksPerTopicSection(
  sectionText: string,
  mergeConsecutiveSameBlocks: boolean
): { text: string; blocksDescription: BlockDescription[] } {
  const blockRe = /<block_(\d+)([^>]*)>([\s\S]*?)<\/block_\1>/g;

  const styleToNewId = new Map<string, number>();
  const blocksDescription: BlockDescription[] = [];
  let nextId = 1;

  const outParts: string[] = [];
  let lastEnd = 0;

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(sectionText)) !== null) {
    const start = m.index;
    const end = blockRe.lastIndex;

    const attrsChunk = m[2] ?? "";
    const inner = m[3] ?? "";

    outParts.push(sectionText.slice(lastEnd, start));

    const attrs = parseAttrs(attrsChunk);
    const key = styleKeyFromAttrs(attrs);

    let newId = styleToNewId.get(key);
    if (!newId) {
      newId = nextId++;
      styleToNewId.set(key, newId);
      blocksDescription.push({ blockId: newId, description: describeAttrs(attrs) });
    }

    outParts.push(`<block_${newId}>${inner}</block_${newId}>`);

    lastEnd = end;
  }

  outParts.push(sectionText.slice(lastEnd));
  let normalized = outParts.join("");

  if (mergeConsecutiveSameBlocks) {
    normalized = mergeConsecutiveSameBlockIds(normalized);
  }

  return { text: normalized, blocksDescription };
}

export function splitTextByTopics(
  topicsJson: TopicWithId[] | string,
  taggedText: string,
  opts: Options = {}
): SplitByTopicsResult {
  const {
    keepBlockWrappers = true,
    mergeConsecutiveSameBlocks = true,
  } = opts;

  const topicsList = parseTopicsJson(topicsJson);

  const idToIndex = new Map<number, number>();
  for (let i = 0; i < topicsList.length; i++) idToIndex.set(topicsList[i].id, i);

  const buffers: string[][] = topicsList.map(() => []);

  const blockRe = /<block_(\d+)(?:\s[^>]*)?>([\s\S]*?)<\/block_\1>/g;

  let currentTopicIndex: number | null = null;
  let lastEnd = 0;

  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(taggedText)) !== null) {
    const matchStart = m.index;
    const matchEnd = blockRe.lastIndex;

    const id = Number(m[1]);
    const rawBlock = m[0];
    const inner = m[2];

    const gap = taggedText.slice(lastEnd, matchStart);
    if (currentTopicIndex !== null && gap) buffers[currentTopicIndex].push(gap);

    const idx = idToIndex.get(id);
    if (idx !== undefined) {
      currentTopicIndex = idx;
      lastEnd = matchEnd;
      continue;
    }

    if (currentTopicIndex !== null) {
      buffers[currentTopicIndex].push(keepBlockWrappers ? rawBlock : inner);
    }

    lastEnd = matchEnd;
  }

  const tail = taggedText.slice(lastEnd);
  if (currentTopicIndex !== null && tail) buffers[currentTopicIndex].push(tail);

  const topics = topicsList.map((t, i) => {
    const rawText = buffers[i].join("");

    if (!keepBlockWrappers) {
      return { topic: t.topic, blocksDescription: [], text: rawText };
    }

    const normalized = normalizeBlocksPerTopicSection(
      rawText,
      mergeConsecutiveSameBlocks
    );

    return {
      topic: t.topic,
      blocksDescription: normalized.blocksDescription,
      text: normalized.text,
    };
  });

  return { topics };
}

export function printSplitByTopicsResult(res: SplitByTopicsResult) {
  console.log(
    util.inspect(res, {
      depth: null,
      colors: true,
      maxArrayLength: null,
      breakLength: 120,
      compact: false,
    })
  );
}

export async function saveContentDictAsTs(content: any, outputDir: string, originalFileName: string) {
  try {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeName = originalFileName.replace(path.extname(originalFileName), "").replace(/[^a-z0-9]/gi, "_");
    const filePath = path.join(outputDir, `${safeName}_content.ts`);

    const jsonString = JSON.stringify(content, null, 2);

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

    const fileContent = `export const content = ${tsFormattedString};`;

    fs.writeFileSync(filePath, fileContent);
  } catch (error) {
    console.error("❌ Error saving content dict:", error);
  }
}