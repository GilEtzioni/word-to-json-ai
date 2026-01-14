import React from "react";
import { FloatButton, Tooltip } from "antd";
import { FileWordOutlined } from "@ant-design/icons";

type ExampleDocxProps = {
  href?: string;
  downloadName?: string;
  disabled?: boolean;
};

const ExampleDocx: React.FC<ExampleDocxProps> = ({
  href = "/example.docx",
  downloadName = "example.docx",
  disabled = false
}) => {
  const onDownload = () => {
    if (disabled) return;

    const a = document.createElement("a");
    a.href = href;
    a.download = downloadName;
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  return (
    <>
      <Tooltip title="Download Docx example" placement="left">
        <FloatButton
          onClick={onDownload}
          shape="circle"
          type="default"
          icon={<FileWordOutlined />}
          aria-label="Download example docx"
          style={{
            width: 60,
            height: 60,
            border: "1px solid rgba(147, 197, 253, 0.55)",
            background:
              "radial-gradient(120% 120% at 35% 30%, rgba(96,165,250,0.28) 0%, rgba(59,130,246,0.22) 35%, rgba(30,64,175,0.18) 70%, rgba(15,23,42,0.22) 100%)",
            boxShadow:
              "0 18px 35px rgba(0,0,0,0.45), 0 0 0 6px rgba(59,130,246,0.18)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            opacity: disabled ? 0.55 : 1
          }}
          className="example-docx-float"
        />
      </Tooltip>

      <style>{`
        .example-docx-float .ant-float-btn-body {
          background: transparent !important;
        }
        .example-docx-float .anticon {
          font-size: 26px !important;
          color: rgba(255,255,255,0.95) !important;
        }
      `}</style>
    </>
  );
};

export default ExampleDocx;
