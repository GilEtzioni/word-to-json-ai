import React from "react";
import { Button, Flex } from "antd";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faLightbulb } from "@fortawesome/free-solid-svg-icons";

interface InstructionsButtonProps {
  onClick: () => void;
}

const InstructionsButton: React.FC<InstructionsButtonProps> = ({ onClick }) => (
  <Flex wrap gap="small">
    <Button
      onClick={onClick}
      icon={<FontAwesomeIcon icon={faLightbulb} className="text-white/90" />}
      className={`
        !h-auto !px-4 !py-2
        font-hebrew !text-[14px] !font-semibold !leading-none
        !text-white
        !border !border-white/15
        !bg-white/5 hover:!bg-white/8 active:!bg-white/10
        !rounded-[12px]
        backdrop-blur-md
        shadow-[0_8px_20px_rgba(0,0,0,0.5)]
        hover:shadow-[0_10px_26px_rgba(0,0,0,0.55)]
        transition-all duration-200
        flex items-center gap-2
        relative overflow-hidden

        before:content-[''] before:absolute before:inset-0
        before:bg-gradient-to-b before:from-white/12 before:via-white/6 before:to-white/0
        before:pointer-events-none

        after:content-[''] after:absolute after:inset-0
        after:bg-[radial-gradient(120%_90%_at_50%_0%,rgba(255,255,255,0.18),transparent_55%)]
        after:pointer-events-none
      `}
    >
      Instructions For The LLM
    </Button>
  </Flex>
);

export default InstructionsButton;
