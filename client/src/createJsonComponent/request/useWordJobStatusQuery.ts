import { useQuery } from "@tanstack/react-query";
import { getWordJobStatus, getBatchWordJobStatus, WordJobStatus } from "../../api/wordToJsonApi";

export const wordJobKeys = {
  status: (jobId: string) => ["word-job", jobId] as const,
  batchStatus: (jobIds: string[]) => ["word-job-batch", jobIds] as const,
};

export default function useWordJobStatusQuery(jobId?: string, enabled = true) {
  return useQuery<WordJobStatus>({
    queryKey: wordJobKeys.status(jobId ?? "none"),
    queryFn: () => getWordJobStatus(jobId!),
    enabled: Boolean(jobId) && enabled,
    refetchInterval: (query) => (query.state.data?.done ? false : 500),
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}

export function useBatchWordJobStatusQuery(jobIds: string[], enabled = true) {
  return useQuery({
    queryKey: wordJobKeys.batchStatus(jobIds),
    queryFn: () => getBatchWordJobStatus(jobIds),
    enabled: jobIds.length > 0 && enabled,
    
    refetchInterval: (query) => {
      const data = query.state.data;
      if (Array.isArray(data) && data.length > 0 && data.every(job => job.done)) {
        return false;
      }
      return 500; // poll every half second
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}