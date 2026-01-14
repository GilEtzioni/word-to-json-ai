import axiosInstance from "./common/axiosInstance";
import { jsonStatusBatchUrl, jsonStatusUrl, jsonUrl } from "./common/keys";

export type FieldItem = {
  field: string;
  type: string;
};

export type WordJobStatus = {
  step: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  label: string;
  done: boolean;
  partial?: {
    fields?: (string | FieldItem)[]; 
    [key: string]: any;
  };
  result?: Record<string, any>;
};

export type JobInfo = {
  fileName: string;
  jobId: string;
};

export type BatchUploadResponse = {
  message: string;
  jobs: JobInfo[];
};

export type FileInstructionSet = {
  topic_instructions?: string;
  json_instructions?: string;
  comments?: string;
};

export function getFieldLabel(item: string | FieldItem): string {
  if (typeof item === 'string') return item;
  return item?.field || "";
}

export async function uploadMultipleWordsForJson(
  files: File[],
  onUploadProgress?: (ev: any) => void,
  fileInstructions?: FileInstructionSet[],
  topic_instructions?: string,
  json_instructions?: string,
  comments?: string,
  promptData?: any
): Promise<BatchUploadResponse> {
  const form = new FormData();

  if (fileInstructions && fileInstructions.length > 0) {
    form.append("file_instructions_map", JSON.stringify(fileInstructions));
  }
  if (topic_instructions?.trim()) form.append("topic_instructions", topic_instructions);
  if (json_instructions?.trim()) form.append("json_instructions", json_instructions);
  if (comments?.trim()) form.append("comments", comments);

  if (promptData) {
    form.append("prompt_data", JSON.stringify(promptData));
  }

  files.forEach((file) => {
    form.append("files", file);
  });

  const res = await axiosInstance.post<BatchUploadResponse>(jsonUrl, form, {
    onUploadProgress,
    headers: {
      "Content-Type": undefined,
    },
  });

  return res.data;
}

export async function getBatchWordJobStatus(jobIds: string[]): Promise<(WordJobStatus & { jobId: string })[]> {
  const res = await axiosInstance.post(jsonStatusBatchUrl, { ids: jobIds });
  return res.data;
}

export async function getWordJobStatus(jobId: string): Promise<WordJobStatus> {
  const res = await axiosInstance.get<WordJobStatus>(`${jsonStatusUrl}${jobId}`);
  return res.data;
}

export function pollWordJob(
  jobId: string,
  onUpdate: (status: WordJobStatus) => void,
  intervalMs = 1000
): () => void {
  let timer: any = null;

  const tick = async () => {
    try {
      const s = await getWordJobStatus(jobId);
      onUpdate(s);
      if (!s.done) {
        timer = setTimeout(tick, intervalMs);
      }
    } catch (err) {
      console.error(`Error polling job ${jobId}:`, err);
    }
  };

  timer = setTimeout(tick, intervalMs);
  return () => { if (timer) clearTimeout(timer); };
}