import { useMutation } from "@tanstack/react-query";
import { uploadMultipleWordsForJson, BatchUploadResponse, FileInstructionSet } from "../../api/wordToJsonApi";

type Vars = {
  files: File[];
  onUploadProgress?: (ev: any) => void;
  fileInstructions?: FileInstructionSet[];
  topic_instructions?: string;
  json_instructions?: string;
  comments?: string;
};

export default function useWordToJsonWithJobMutate() {
  return useMutation<BatchUploadResponse, unknown, Vars>({
    mutationFn: (vars) =>
      uploadMultipleWordsForJson(
        vars.files, 
        vars.onUploadProgress, 
        vars.fileInstructions,
        vars.topic_instructions, 
        vars.json_instructions, 
        vars.comments
      ),
  });
}