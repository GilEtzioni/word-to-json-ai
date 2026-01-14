import path from "path";
import { pathToFileURL } from "url";
import { mainHighlightDocx, TopicBlock } from "./wordMaker";

async function loadItemsModule(userPath?: string): Promise<TopicBlock[]> {
  const guess = userPath ?? "./my_items";
  const abs = path.isAbsolute(guess) ? guess : path.resolve(process.cwd(), guess);
  const mod = await import(pathToFileURL(abs).href);
  const items = (mod.my_items ?? mod.default) as TopicBlock[];
  if (!Array.isArray(items)) throw new Error(`Items module "${guess}" does not export array "my_items".`);
  return items;
}

(async () => {
  const input = process.argv[2] ?? "gtel-1.docx";
  const output = process.argv[3] ?? "gtel_1_output.docx";
  const itemsModulePath = process.argv[4]; 

  const items = await loadItemsModule(itemsModulePath);

  const result = await mainHighlightDocx({
    input,
    output,
    items,
  });

  if (result.notFound.length) {
    console.log(`[marker] Done. ${result.notFound.length} clauses not found.`);
  } else {
    console.log("[marker] Done. All clauses found at least once.");
  }
})().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});