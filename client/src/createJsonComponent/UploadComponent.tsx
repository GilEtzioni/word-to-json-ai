import React from "react";
import { FileWordOutlined } from "@ant-design/icons";
import { Upload, message, Space, Image, Col, Row, Card } from "antd";
import type { UploadProps, UploadFile } from "antd";
import DeleteButton from "../common/DeleteButton";
import InstructionsButton from "../common/InstructionsButton";
import Docs_Pdf_Files_Image from "./Docs_Pdf_Files_Image_1.png";

const { Dragger } = Upload;

type UploadComponentProps = {
  fileList: UploadFile[];
  setFileList: (files: UploadFile[]) => void;
  maxFiles?: number;
  disabled?: boolean;
  onOpenInstructions: (file?: UploadFile) => void;
};

const UploadComponent: React.FC<UploadComponentProps> = ({
  fileList,
  setFileList,
  maxFiles,
  disabled,
  onOpenInstructions,
}) => {
  const props: UploadProps = {
    name: "file",
    multiple: true,
    accept: ".doc,.docx",
    fileList: fileList,
    disabled: disabled,
    showUploadList: true,

    itemRender: (originNode, file) => {
      const index = fileList.findIndex((item) => item.uid === file.uid);

      return (
        <div
          className="
            flex items-center justify-between
            px-3 py-2
            rounded-xl
            bg-white/5
            border border-white/15
            text-white
            shadow-[0_10px_30px_rgba(0,0,0,0.20)]
          "
          style={{
            marginBottom: "8px",
            marginTop: index === 0 ? "24px" : "0",
            position: "relative",
          }}
        >
          <Space>
            <FileWordOutlined style={{ color: "#93c5fd", fontSize: "18px" }} />
            <span style={{ direction: "ltr" }} className="text-white/90">
              {file.name}
            </span>
          </Space>

          <div
            style={{
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 1,
            }}
          >
            <InstructionsButton
              onClick={() => onOpenInstructions(file)}
            />
          </div>

          <Space>
            <DeleteButton
              onClick={() => {
                const newFileList = fileList.filter((item) => item.uid !== file.uid);
                setFileList(newFileList);
              }}
            />
          </Space>
        </div>

      );
    },

    beforeUpload: (file) => {
      if (maxFiles && fileList.length >= maxFiles) {
        message.error(`You can add max ${maxFiles} files`);
        return Upload.LIST_IGNORE;
      }
      setFileList([...fileList, file]);
      return false;
    },
  };

  return (
    <div style={{ marginInline: "auto" }}>
      <Card
        className="
          mt-14
          h-full flex flex-col
          !rounded-3xl
          !bg-white/10
          backdrop-blur-xl
          !border !border-white/15
          shadow-[0_25px_80px_rgba(0,0,0,0.45)]
          w-[100%]
        "
        styles={{ body: { background: "transparent" } }}
      >
        <Dragger
          {...props}
          showUploadList={true}
          style={{ padding: 0 }}
        >
          <div className="transition-transform duration-500 ease-in-out hover:scale-[1.05] p-0">
            <Row align="middle" justify="center" gutter={32}>
              <Col>
                <Image
                  src={Docs_Pdf_Files_Image}
                  alt="Upload Files"
                  preview={false}
                  height={80}
                />
              </Col>

              <Col>
                <p className="ant-upload-text font-hebrew !text-white" style={{ margin: 0, fontSize: "18px", fontWeight: "bold" }}>
                  Add Or Drag Files
                </p>
                <p className="ant-upload-hint font-hebrew !text-white/60" style={{ margin: "5px 0 0 0" }}>
                  You Must Add At Least One File
                </p>
              </Col>
            </Row>
          </div>
        </Dragger>
      </Card>
    </div>
  );
};

export default UploadComponent;
