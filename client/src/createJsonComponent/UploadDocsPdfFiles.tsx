import React from "react";
import { InboxOutlined } from "@ant-design/icons";
import { Card, Upload } from "antd";
const { Dragger } = Upload;

const UploadDocsPdfFiles: React.FC= () => {

  return (
    <div style={{ direction: "rtl" }}>
      <Card className="rounded-2xl border border-neutral-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)]" style={{ background: "#fff", width: "40%", marginInline: "auto" }}>
        <Dragger style={{ background: "#fff" }}> 
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">לחץ / גרור קבצי PDF / WORD / DOCS</p>
          <p className="ant-upload-hint">אין הגבלה על כמות הקבצים</p>
        </Dragger>
      </Card>
    </div>
  );
};

export default UploadDocsPdfFiles;