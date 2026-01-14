import type { Request, Response, RequestHandler } from "express";
import path from "path";
import fs from "fs";
import * as findTopics from "./agents/findTopic"
import * as findContent from "./agents/findContent";
import * as createItems from "./agents/createItems";
import * as createDocsComments from "./agents/createDocsCommetns";
import * as helpersMain from "./utils/helperMain";
import { find_all_fields } from "./agents/schemaFieldFinder";
import { createJob, updateJob } from "./utils/wordJobStore"; 
import { convertDocxShiftEnterToEnter } from "./utils/addEnter";
import { removePrefix } from "./utils/removePrefix";
import { zipFolder } from "./utils/zipFolder";

type Topic = { topic: string; id: number };

async function processFile(
  file: Express.Multer.File, 
  specificInstructions: any, 
  jobId: string, 
  promptData: any
) {
  try {
    const topic_instructions = specificInstructions?.topic_instructions?.trim() || undefined;
    const json_instructions = specificInstructions?.json_instructions?.trim() || undefined;
    const comments = specificInstructions?.comments?.trim() || undefined;

    const ext = path.extname(file.originalname) || "";
    let storedPath = file.path;
    if (ext && !storedPath.endsWith(ext)) {
      const renamed = `${storedPath}${ext}`;
      fs.renameSync(storedPath, renamed);
      storedPath = renamed;
    }
    const ABS_PATH = path.resolve(storedPath);

    // step 1: topics
    updateJob(jobId, { step: 1, label: `findTopics: ${file.originalname}` }); 
    const word_buffer = fs.readFileSync(ABS_PATH);
    const word_file = await convertDocxShiftEnterToEnter(word_buffer);
    const text_with_blocks = await findTopics.extract_topics(word_file, undefined, undefined, true);
    const topics_json = await findTopics.extract_topics(text_with_blocks, topic_instructions);
    let topics_array: string[] = [];
    if (Array.isArray(topics_json)) {
      topics_array = topics_json.map((t: Topic) => t.topic);
    }

    updateJob(jobId, {
      partial: { topics: topics_array, topics_count: topics_array?.length || 0 }, 
    });

    // step 2: content
    updateJob(jobId, { step: 2, label: "findContent" }); 
    const content_dict = await findContent.splitTextByTopics(topics_json, text_with_blocks);
    await findContent.saveContentDictAsTs(content_dict, "./output_files/debug", `${file.originalname}_step_2_conetent_dictionary`);    
    updateJob(jobId, { partial: { content: content_dict } });

    // step 3: fields
    updateJob(jobId, { step: 3, label: "findFields" }); 
    const fields = await find_all_fields(content_dict, { path: ABS_PATH, model: "gpt-4o-mini", json_instructions });
    updateJob(jobId, { partial: { fields } });

    // step 4: items
    updateJob(jobId, { step: 4, label: "createItems" }); 
    const items = await createItems.process_document(content_dict, fields, comments);
    await createItems.saveItemsAsTs(items, "./output_files/debug", `${file.originalname}_step_4_items`);
    updateJob(jobId, { partial: { items } });

    // step 5: delete preffix
    updateJob(jobId, { step: 5, label: "deletePrefix" }); 
    // createItems.printItems(items);
    const { cleaned_items, prefixFound } = await removePrefix.process_document(items, fields);
    updateJob(jobId, { partial: { prefixFound } });

    // step 6: create jsons + word recap files
    updateJob(jobId, { step: 6, label: "createJsons" });
    await helpersMain.saveJsonsPerContent(cleaned_items, `./output_files/json_files/${file.originalname}`);
    const output_path = await createDocsComments.processDocument(ABS_PATH, cleaned_items, "./output_files/ai_explanataions");

    // create the zip
    const jsonDir = path.resolve(`./output_files/json_files/${file.originalname}`);
    const zipPath = path.resolve(`./output_files/zips/${jobId}.zip`);
    await zipFolder(jsonDir, zipPath);

    // final step: done
    updateJob(jobId, {
      step: 7, 
      label: "done",
      done: true,
      result: {
        fileName: file.originalname,
        topics: topics_array,
        topics_count: topics_array?.length || 0,
        items_count: Array.isArray(items) ? items.length : 0,
        output_path,
        zipPath
      },
    });
  } catch (err: any) {
    updateJob(jobId, { label: "error", done: true, result: { error: err?.message || "internal error" } });
    console.error(`Error processing file ${file.originalname}:`, err);
  }
}

function resetOutputFilesFolder() {
  const outDir = path.resolve("./output_files");

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  fs.mkdirSync(path.join(outDir, "debug"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "json_files"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "ai_explanataions"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "zips"), { recursive: true });
}

export const processWordHttpJson: RequestHandler = (req: Request, res: Response) => {
  const files = req.files as Express.Multer.File[];

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }
  
  resetOutputFilesFolder();

  let promptData: any = {};
  if (req.body.prompt_data) {
    try {
      promptData = JSON.parse(req.body.prompt_data);
    } catch (e) {
      console.error("Failed to parse prompt_data", e);
    }
  }

  let instructionsArray: any[] = [];
  try {
    const rawMap = req.body.file_instructions_map;
    if (rawMap && typeof rawMap === 'string' && rawMap.trim() !== '') {
      instructionsArray = JSON.parse(rawMap);
    }
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON in file_instructions_map" });
  }

  const fileJobs = files.map(f => ({
    fileName: f.originalname,
    jobId: createJob()
  }));

  res.status(202).json({ 
    message: `Started processing ${files.length} files`,
    jobs: fileJobs 
  });

  files.forEach((file, index) => {
    const jobId = fileJobs[index].jobId;
    const specificInstructions = {
      topic_instructions: instructionsArray[index]?.topic_instructions || req.body.topic_instructions,
      json_instructions: instructionsArray[index]?.json_instructions || req.body.json_instructions,
      comments: instructionsArray[index]?.comments || req.body.comments,
    };

    processFile(file, specificInstructions, jobId, promptData).catch(err => {
      console.error(`Error for [${file.originalname}]:`, err);
    });
  });
};