import crypto from "crypto";

export type WordJobStatus = {
  step: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;   
  label: string;
  done: boolean;
  partial?: Record<string, any>;
  result?: Record<string, any>;
};

const jobs = new Map<string, WordJobStatus>();

export function createJob(): string {
  const id = crypto.randomUUID();
  jobs.set(id, { step: 0, label: "queued", done: false });
  return id;
}

export function updateJob(id: string, patch: Partial<WordJobStatus>) {
  const prev = jobs.get(id) || { step: 0, label: "queued", done: false };
  jobs.set(id, {
    ...prev,
    ...patch,
    partial: (prev.partial || patch.partial)
      ? { ...(prev.partial || {}), ...(patch.partial || {}) }
      : undefined,
    result: (prev.result || patch.result)
      ? { ...(prev.result || {}), ...(patch.result || {}) }
      : undefined,
  });
}

export function getJob(id: string): WordJobStatus | undefined {
  return jobs.get(id);
}