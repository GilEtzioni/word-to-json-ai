import React, { useEffect, useState } from "react";
import { message, UploadFile } from "antd";
import CreateJsonButton from "./CreateJsonButton";
import UploadComponent from "./UploadComponent";
import StepsCards from "./StepsCards";
import { useBatchWordJobStatusQuery } from "./request/useWordJobStatusQuery";
import useWordToJsonWithJobMutate from "./request/useWordToJsonWithJobMutate";
import FileInstructionsModal from "./FileInstructionsModal";
import { FaRegCopyright } from "react-icons/fa";

interface FileInstructions {
  topics: string;
  fields: string;
  comments: string;
}

const CreateJsonContainer: React.FC = () => {
  const [globalTopics, setGlobalTopics] = useState("");
  const [globalFields, setGlobalFields] = useState("");
  const [globalComments, setGlobalComments] = useState("");

  const [instructionsMap, setInstructionsMap] = useState<Record<string, FileInstructions>>({});
  const [editingFile, setEditingFile] = useState<UploadFile | null>(null);
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false);

  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [fileMap, setFileMap] = useState<Record<string, string>>({});
  const [isStepsOpen, setIsStepsOpen] = useState(false);
  const [maxFiles, setMaxFiles] = useState<number | undefined>(3);

  const { mutateAsync, isPending } = useWordToJsonWithJobMutate();
  const { data: batchStatuses } = useBatchWordJobStatusQuery(jobIds, jobIds.length > 0);

  useEffect(() => {
    if (jobIds.length > 0) setIsStepsOpen(true);
  }, [jobIds]);

  const getFileInstructions = (uid: string): FileInstructions => {
    return instructionsMap[uid] || { 
      topics: globalTopics, 
      fields: globalFields, 
      comments: globalComments 
    };
  };

  const updateInstruction = (uid: string | undefined, field: keyof FileInstructions, value: string) => {
    if (!uid) {
      if (field === "topics") setGlobalTopics(value);
      if (field === "fields") setGlobalFields(value);
      if (field === "comments") setGlobalComments(value);
    } else {
      setInstructionsMap((prev) => ({
        ...prev,
        [uid]: { ...getFileInstructions(uid), [field]: value },
      }));
    }
  };

  const handleStartProcess = async () => {
    if (fileList.length === 0) {
      message.warning("You Must add At Least One File");
      return;
    }

    const filesToUpload = fileList
      .map((f: any) => (f instanceof File ? f : f.originFileObj))
      .filter((f): f is File => f !== null);

    const fileInstructionsArray = fileList.map((f) => {
      const inst = getFileInstructions(f.uid);
      return {
        topic_instructions: inst.topics,
        json_instructions: inst.fields,
        comments: inst.comments,
      };
    });

    try {
      const data = await mutateAsync({
        files: filesToUpload,
        fileInstructions: fileInstructionsArray,
        topic_instructions: globalTopics,
        json_instructions: globalFields,
        comments: globalComments,
      });

      if (data.jobs && data.jobs.length > 0) {
        const newMap: Record<string, string> = {};
        data.jobs.forEach((j) => (newMap[j.jobId] = j.fileName));
        setFileMap(newMap);
        setJobIds(data.jobs.map((j) => j.jobId));
        message.success(`Proccess started for ${data.jobs.length} file`);
      }
    } catch (err) {
      message.error("Failed To Upload The Files");
    }
  };

  const activeUid = editingFile?.uid;
  const activeInst = activeUid 
    ? getFileInstructions(activeUid) 
    : { topics: globalTopics, fields: globalFields, comments: globalComments };

  return (
    <>
      <StepsCards
        statuses={batchStatuses}
        jobIds={jobIds}
        fileMap={fileMap}
        open={isStepsOpen}
        onClose={() => setIsStepsOpen(false)}
      />

      <FileInstructionsModal
        open={isInstructionsOpen}
        onClose={() => {
          setIsInstructionsOpen(false);
          setEditingFile(null);
        }}
        fileName={editingFile?.name}
        topics={activeInst.topics}
        setTopics={(val) => updateInstruction(activeUid, "topics", val)}
        fields={activeInst.fields}
        setFields={(val) => updateInstruction(activeUid, "fields", val)}
        comments={activeInst.comments}
        setComments={(val) => updateInstruction(activeUid, "comments", val)}
      />

      <UploadComponent
        fileList={fileList}
        setFileList={setFileList}
        maxFiles={6}
        disabled={isPending}
        onOpenInstructions={(file) => {
          setEditingFile(file || null);
          setIsInstructionsOpen(true);
        }}
      />


    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
      <div className="mb-5">
        <CreateJsonButton onClick={handleStartProcess} loading={isPending} />
      </div>
      <p className="text-white flex items-center gap-1">
        <FaRegCopyright /> Created By Gil Etzioni
      </p>    
    </div>
    </>
  );
};

export default CreateJsonContainer;