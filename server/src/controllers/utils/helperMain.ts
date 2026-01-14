import { promises as fs } from "node:fs";
import * as path from "node:path";

export type QA = { question: string; answer: string };
export type ExtractedItem = Record<string, string | boolean | number | null>;

export type TopicListItemLegacy = { topic?: string; qa?: QA[] | null };
export type TopicListItemNew = { topic?: string; items?: ExtractedItem[] | null };

export type ItemsInput =
  | Record<string, QA[] | ExtractedItem[] | null | undefined>
  | (TopicListItemLegacy | TopicListItemNew)[];

export function slug(s: string): string {
  const keep = new Set(["-", "_", ".", "(", ")", " "]);
  const mapped = [...s]
    .map((ch) => (/[A-Za-z0-9]/.test(ch) || keep.has(ch) ? ch : "_"))
    .join("");
  const collapsed = mapped.trim().replace(/\s+/g, "_");
  const trimmed = collapsed.replace(/^[._]+|[._]+$/g, "");
  return trimmed || "untitled";
}

export async function uniquePath(
  baseDir: string,
  stem: string,
  ext = ".json"
): Promise<string> {
  const first = path.join(baseDir, `${stem}${ext}`);
  try {
    await fs.access(first);
  } catch {
    return first;
  }

  let i = 1;
  while (true) {
    const candidate = path.join(baseDir, `${stem}-${i}${ext}`);
    try {
      await fs.access(candidate);
      i += 1;
    } catch {
      return candidate;
    }
  }
}

export async function saveJsonsPerContent(
  items: ItemsInput,
  outDir = "./jsons"
): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  
  type Norm = { topic: string; arr: (QA | ExtractedItem)[] };
  let norm: Norm[];

  if (Array.isArray(items)) {
    norm = items.map((it) => {
      const topic = (it as any).topic ?? "untitled";
      const arr =
        Array.isArray((it as any).items)
          ? (it as any).items
          : Array.isArray((it as any).qa)
          ? (it as any).qa
          : [];
      return { topic, arr };
    });
  } else if (items && typeof items === "object") {
    norm = Object.entries(items).map(([k, v]) => ({
      topic: k ?? "untitled",
      arr: Array.isArray(v) ? v : [],
    }));
  } else {
    throw new TypeError("saveJsonsPerContent expected list or dict");
  }

  let count = 0;
  let skipped = 0;

  for (const { topic, arr } of norm) {
    const contentArr = Array.isArray(arr) ? arr : [];

    if (contentArr.length === 0) {
      skipped += 1;
      console.log(`Skipped (empty array): ${JSON.stringify(topic)}`);
      continue;
    }

    const fnameStem = slug(topic) || "untitled";
    const filePath = await uniquePath(outDir, fnameStem);

    await fs.writeFile(filePath, JSON.stringify(contentArr, null, 2), {
      encoding: "utf-8",
    });
    count += 1;
    console.log(`Saved ${filePath}`);
  }

  console.log(`Saved ${count} files to ${outDir}; skipped ${skipped} empty topics.`);
}

export default { slug, uniquePath, saveJsonsPerContent };