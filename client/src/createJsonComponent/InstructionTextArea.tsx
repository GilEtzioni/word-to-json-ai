import React from "react";
import { Col, Row, Typography } from "antd";
import AnimatedPlaceholderTextArea from "./AnimatedPlaceholderTextArea";

const { Text } = Typography;

interface InstructionTextAreaProps {
  title: string;
  value: string;
  onChange: (value: string) => void;
  placeholderText: string;
  emphasizeTerms?: string[];
}

const InstructionTextArea: React.FC<InstructionTextAreaProps> = ({
  title,
  value,
  onChange,
  placeholderText,
  emphasizeTerms,
}) => {
  return (
    <Col className="flex-1">
      <Row>
        <Text strong className="font-hebrew text-center m-0">
          {title}
        </Text>
      </Row>
      <Row>
        <AnimatedPlaceholderTextArea
          className="w-full h-full rounded-2xl border border-neutral-200 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholderText={placeholderText}
          autoSize={{ minRows: 14, maxRows: 14 }}
          speedMs={55}
          endPauseMs={1100}
          cursor
          emphasizeTerms={emphasizeTerms}
        />
      </Row>
    </Col>
  );
};

export default InstructionTextArea;