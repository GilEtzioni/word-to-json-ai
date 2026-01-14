import React from "react";
import { Modal, Row } from "antd";
import InstructionTextArea from "./InstructionTextArea";

interface FileInstructionsModalProps {
  open: boolean;
  onClose: () => void;
  topics: string;
  setTopics: (val: string) => void;
  fields: string;
  setFields: (val: string) => void;
  comments: string;
  setComments: (val: string) => void;
  fileName?: string;
}

const text1 = `Example:

The only files names are this:
- customers
- orders
- products
- inventory
`;

const text2 = `Example:

You MUST find only this
- Questions
- Answer
`;

const text3 = `Example:

The questions have orange font...`;

const FileInstructionsModal: React.FC<FileInstructionsModalProps> = ({
  open,
  onClose,
  topics,
  setTopics,
  fields,
  setFields,
  comments,
  setComments,
  fileName,
}) => {
  return (
        <Modal
        open={open}
        onCancel={onClose}
        width={1000}
        footer={null}
        destroyOnClose={false}
        >
      <Row gutter={[16, 16]} className="w-full mt-4" >
        <InstructionTextArea 
          title="Instructions For the Json's Files Names" 
          value={topics} 
          onChange={setTopics} 
          placeholderText={text1} 
        />
        <InstructionTextArea 
          title="Instructions For the Json's Fields" 
          value={fields} 
          onChange={setFields} 
          placeholderText={text2} 
        />
        <InstructionTextArea 
          title="More Instructions For The AI Agents"
          value={comments} 
          onChange={setComments} 
          placeholderText={text3} 
        />
      </Row>
    </Modal>
  );
};

export default FileInstructionsModal;