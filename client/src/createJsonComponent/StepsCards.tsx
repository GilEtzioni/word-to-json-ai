import React, { ReactNode, useEffect, useRef, useState } from "react";
import { Modal, Steps, Typography, ConfigProvider, Spin, Button, Space, Card, Alert } from "antd";
import type { WordJobStatus } from "../api/wordToJsonApi";
import aiLogo from "./AI_Logo.jpg";
import { CheckCircleFilled, ClockCircleOutlined, LoadingOutlined, CloseCircleFilled } from "@ant-design/icons";

const { Text } = Typography;

type Props = {
  statuses?: (WordJobStatus & { jobId: string })[];
  jobIds: string[];
  fileMap?: Record<string, string>;
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
};

function normalizeTopics(topics: any): string[] {
  if (Array.isArray(topics)) return topics;
  if (typeof topics === "string") {
    try {
      const parsed = JSON.parse(topics);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
}

function ensureJsonSuffix(name: string): string {
  const trimmed = String(name).trim();
  return trimmed.toLowerCase().endsWith(".json") ? trimmed : `${trimmed}.json`;
}

function formatHMS(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(m)}:${pad(s)}`;
}

const StepsCards: React.FC<Props> = ({ statuses, jobIds, fileMap, open, onClose, title }) => {
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [cacheMap, setCacheMap] = useState<Record<string, any>>({});
  const [, forceTick] = useState(0);

  const downloadedRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    console.log("statuses updated", statuses);
  }, [statuses]);

  useEffect(() => {
    if (open && jobIds.length > 0 && !activeJobId) {
      setActiveJobId(jobIds[0]);
    }
  }, [open, jobIds, activeJobId]);

  useEffect(() => {
    if (!open || !statuses || statuses.every(s => s.done)) return;
    const t = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [open, statuses]);

  useEffect(() => {
    if (!statuses) return;
    setCacheMap(prev => {
      const next = { ...prev };
      statuses.forEach(s => {
        if (!next[s.jobId]) next[s.jobId] = { startedAt: Date.now(), lastStep: -1 };
        const currentStep = s.step || 0;
        if (next[s.jobId].lastStep !== currentStep) {
          next[s.jobId].lastStep = currentStep;
          next[s.jobId].stepStartedAt = Date.now();
        }
        const p = s.partial as any;
        if (p?.topics) next[s.jobId].topics = p.topics;
        if (p?.fields) next[s.jobId].fields = p.fields;

        if (p?.prefixFound !== undefined) {
          next[s.jobId].prefixFound = p.prefixFound;
        }

        if (s.result) next[s.jobId].result = { ...(next[s.jobId].result || {}), ...s.result };
      });
      return next;
    });
  }, [statuses]);

  const API_BASE = process.env.REACT_APP_API_BASE || "";

  const downloadZip = async (jobId: string) => {
    const res = await fetch(`${API_BASE}/api/json/download/${jobId}`);

    const ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Download failed status=${res.status} ct=${ct}\n${text.slice(0, 300)}`);
    }

    const buf = await res.arrayBuffer();
    const u8 = new Uint8Array(buf);

    // ZIP files start with "PK"
    const isZip = u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b;
    if (!isZip) {
      const text = new TextDecoder().decode(u8.slice(0, 300));
      throw new Error(`Response is not a ZIP. ct=${ct}\n${text}`);
    }

    const blob = new Blob([u8], { type: "application/zip" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    const baseName = (fileMap?.[jobId] || `result-${jobId}`).replace(/[^\w.\- ]+/g, "_");
    a.download = `${baseName}.zip`;

    a.click();
    window.URL.revokeObjectURL(url);
  };

  const activeStatus = statuses?.find(s => s.jobId === activeJobId);
  const current = activeStatus?.step || 0;
  const activeCache = activeJobId ? cacheMap[activeJobId] : null;
  const hasError = activeStatus?.done && !!activeStatus?.result?.error;
  const errorMessage = activeStatus?.result?.error;

  useEffect(() => {
    if (!open) return;
    if (!activeJobId) return;
    if (!activeStatus) return;

    if (activeStatus.done && !activeStatus.result?.error && !downloadedRef.current[activeJobId]) {
      downloadedRef.current[activeJobId] = true;
      downloadZip(activeJobId).catch((e) => {
        console.error("Auto download failed:", e);
        downloadedRef.current[activeJobId] = false;
      });
    }
  }, [open, activeJobId, activeStatus]);

  if (open && (!statuses || statuses.length === 0)) {
    return (
      <ConfigProvider direction="rtl">
        <Modal open={open} onCancel={onClose} footer={null} width={750} title={title}>
          <div style={{ textAlign: "center", padding: "60px" }}>
            <Spin size="large" tip="Please waitå..." />
          </div>
        </Modal>
      </ConfigProvider>
    );
  }

  const subTitleFor = (stIdx: number) => {
    if (current === stIdx && !activeStatus?.done && activeCache?.stepStartedAt) {
      return `(${formatHMS(Date.now() - activeCache.stepStartedAt)})`;
    }
    return undefined;
  };

  const TopicsList = () => {
    const topicsArray = normalizeTopics(activeCache?.topics);
    if (!topicsArray.length) return <Text type="secondary"> Please wait...</Text>;
    return (
      <ul style={{ margin: "8px 0 0 0", paddingInlineStart: 0, fontSize: "12px" }}>
        {topicsArray.map((t: string, i: number) => (
          <li key={i}> • {ensureJsonSuffix(String(t))}</li>
        ))}
      </ul>
    );
  };

  const renderDataStructureOneLine = () => {
    const fields = activeCache?.fields;

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      return "Create data-structure of file_name: [{...}]";
    }

    const internalString = fields
      .map((f: any) => {
        const name = typeof f === "string" ? f : f?.field;
        const type = typeof f === "object" && f?.type ? f.type : "string";
        return `${name}: ${type}`;
      })
      .join(", ");

    return `Create data-structure of file_name: [{ ${internalString} }]`;
  };

  const renderPrefixDescription = () => {
    if (current < 5 && !activeStatus?.done) {
      return <Text type="secondary"> Remove preffix, and arrage the text </Text>;
    }

    const p = activeCache?.prefixFound;

    if (!p || (typeof p === "object" && Object.keys(p).length === 0)) {
      return <Text type="secondary"> Not found any preffix</Text>;
    }

    if (typeof p === "object") {
      return (
        <div style={{ marginTop: 4 }}>
          {Object.keys(p).map((key) => (
            <Text key={key} type="secondary" style={{ fontSize: "13px", display: "block" }}>
              • {key}
            </Text>
          ))}
        </div>
      );
    }

    return <Text type="secondary"> Found preffix {String(p)}</Text>;
  };

  const allStepItems = [
    { title: "Create the Prompt", description: "The AI Agent created the prompt" },
    {
      // @ts-ignore
      hasCustomTimer: true,
      title: (
        <div style={{ display: "flex", alignItems: "center" }}>
          <span> Find Json files names </span>
          <img
            src={aiLogo}
            alt="AI logo"
            style={{ width: "20px", height: "20px", marginRight: "8px", objectFit: "contain" }}
          />
          {subTitleFor(1) && (
            <span style={{ fontSize: "12px", color: "rgba(0, 0, 0, 0.45)", marginRight: "8px" }}>
              {subTitleFor(1)}
            </span>
          )}
        </div>
      ),
      description: <TopicsList />,
    },

    { title: "Sort the text by files", description: "Create data-stracture of [{ file_name: text }]" },
    {
      // @ts-ignore
      hasCustomTimer: true,
      title: (
        <div style={{ display: "flex", alignItems: "center" }}>
          <span> Find the Json fields </span>
          <img
            src={aiLogo}
            alt="AI logo"
            style={{ width: "20px", height: "20px", marginRight: "8px", objectFit: "contain" }}
          />
          {subTitleFor(3) && (
            <span style={{ fontSize: "12px", color: "rgba(0, 0, 0, 0.45)", marginRight: "8px" }}>
              {subTitleFor(3)}
            </span>
          )}
        </div>
      ),
      description:
        activeCache?.fields && Array.isArray(activeCache.fields) ? (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: "4px" }}>
            {activeCache.fields.map((item: any, idx: number) => {
              const fieldName = typeof item === "string" ? item : item?.field || "";
              const fieldType = typeof item === "object" && item?.type ? item.type : null;
              return (
                <Text key={idx} style={{ fontSize: "13px", display: "block" }}>
                  • {fieldName}
                  {fieldType && (
                    <Text type="secondary" style={{ fontSize: "11px", marginLeft: "6px" }}>
                      ({fieldType})
                    </Text>
                  )}
                </Text>
              );
            })}
          </div>
        ) : (
          "Waiting for data..."
        ),
    },

    {
      // @ts-ignore
      hasCustomTimer: true,
      title: (
        <div style={{ display: "flex", alignItems: "center" }}>
          <span> Create the Json files </span>
          <img
            src={aiLogo}
            alt="AI logo"
            style={{ width: "20px", height: "20px", marginRight: "8px", objectFit: "contain" }}
          />
          {subTitleFor(4) && (
            <span style={{ fontSize: "12px", color: "rgba(0, 0, 0, 0.45)", marginRight: "8px" }}>
              {subTitleFor(4)}
            </span>
          )}
        </div>
      ),
      description: renderDataStructureOneLine(),
    },

    {
      // @ts-ignore
      hasCustomTimer: true,
      title: (
        <div style={{ display: "flex", alignItems: "center" }}>
          <span> Find preffix and arrange the files </span>
          <img
            src={aiLogo}
            alt="AI logo"
            style={{ width: "20px", height: "20px", marginRight: "8px", objectFit: "contain" }}
          />
          {subTitleFor(5) && <span style={{ fontSize: "12px", marginRight: "8px" }}>{subTitleFor(5)}</span>}
        </div>
      ),
      description: renderPrefixDescription(),
    },

    { title: "Save JSON files, and a WORD file (that contain explanations)" },
    {
      // @ts-ignore
      hasCustomTimer: true,
      title: (
        <div style={{ display: "flex", alignItems: "center" }}>
          <span> Create KB Test </span>
          <img
            src={aiLogo}
            alt="AI logo"
            style={{ width: "20px", height: "20px", marginRight: "8px", objectFit: "contain" }}
          />

          {subTitleFor(7) && (
            <span style={{ fontSize: "12px", color: "rgba(0, 0, 0, 0.45)", marginRight: "8px" }}>
              {subTitleFor(7)}
            </span>
          )}
        </div>
      ),
      description: activeStatus?.done ? " the bot is ready!" : "export data...",
    },
  ];

  const renderStepsInRange = (start: number, end: number) => {
    const getIcon = (globalIdx: number) => {
      if (hasError && (current === globalIdx || (activeStatus?.done && current < globalIdx))) {
        return current === globalIdx
          ? <CloseCircleFilled style={{ color: "#ff4d4f" }} />
          : <ClockCircleOutlined style={{ color: "#bfbfbf" }} />;
      }
  
      if (activeStatus?.done || current > globalIdx) {
        return <CheckCircleFilled style={{ color: "#52c41a" }} />;
      }
  
      if (current === globalIdx && !activeStatus?.done) {
        return <LoadingOutlined spin />;
      }
  
      return <ClockCircleOutlined style={{ color: "#bfbfbf" }} />;
    };
  
    return (
      <Steps
        direction="vertical"
        size="small"
        current={Math.max(0, current - start)}
        items={allStepItems.slice(start, end + 1).map((item, idx) => {
          const globalIdx = start + idx;
  
          let stepStatus: "wait" | "process" | "finish" | "error" = "wait";
          if (hasError && current === globalIdx) stepStatus = "error";
          else if (activeStatus?.done || current > globalIdx) stepStatus = "finish";
          else if (current === globalIdx) stepStatus = "process";
  
          return {
            ...item,
            status: stepStatus,
            icon: getIcon(globalIdx),
            // @ts-ignore
            subTitle: item.hasCustomTimer ? undefined : subTitleFor(globalIdx),
          };
        })}
      />
    );
  };
  
  const getBorderColor = (start: number, end: number) => {
    if (hasError && current >= start && current <= end) return "#ff4d4f";
    if (activeStatus?.done) return "#52c41a";
    if (current > end) return "#52c41a";
    if (current >= start && current <= end) return "#1890ff";
    return "#f0f0f0";
  };

  const getButtonIcon = (id: string) => {
    const s = statuses?.find(j => j.jobId === id);
    if (s?.done) {
      if (s.result?.error) return <CloseCircleFilled style={{ color: "#ff4d4f" }} />;
      return <CheckCircleFilled style={{ color: "#52c41a" }} />;
    }
    if (activeJobId === id) return <LoadingOutlined spin />;
    return undefined;
  };

  return (
    <ConfigProvider direction="ltr">
      <Modal open={open} onCancel={onClose} footer={null} width={750} title={title}>
        <div
          style={{
            display: "flex",
            overflowX: "auto",
            gap: "8px",
            marginBottom: "2px",
            paddingBottom: "2px",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          {jobIds.map(id => (
            <Button
              key={id}
              type={activeJobId === id ? "primary" : "default"}
              icon={getButtonIcon(id)}
              onClick={() => setActiveJobId(id)}
              danger={!!statuses?.find(s => s.jobId === id)?.result?.error}
            >
              {fileMap?.[id] || id}
            </Button>
          ))}
        </div>

        {activeJobId && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            {hasError && (
              <Alert
                message="Failed"
                description={String(errorMessage || "Unknown error")}
                type="error"
                showIcon
              />
            )}

            <Card size="small" title="Create JSON" style={{ borderRight: `4px solid ${getBorderColor(1, 6)}` }}>
              {renderStepsInRange(1, 6)}
            </Card>
          </Space>
        )}
      </Modal>
    </ConfigProvider>
  );
};

export default StepsCards;
