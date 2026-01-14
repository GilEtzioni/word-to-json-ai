import React from "react";
import { Button, Flex } from "antd";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrash } from "@fortawesome/free-solid-svg-icons";

interface DeleteButtonProps {
  onClick: () => void;
}

const DeleteButton: React.FC<DeleteButtonProps> = ({ onClick }) => (
  <Flex wrap gap="small">
    <Button
      onClick={onClick}
      icon={<FontAwesomeIcon icon={faTrash} className="text-red-100/90" />}
      className={`
        !h-auto !px-4 !py-2
        font-hebrew !text-[14px] !font-semibold !leading-none
        !text-red-50
        !border !border-red-200/15
        !bg-red-500/10 hover:!bg-red-500/14 active:!bg-red-500/18
        !rounded-[12px]
        backdrop-blur-md
        shadow-[0_8px_20px_rgba(0,0,0,0.5)]
        hover:shadow-[0_10px_26px_rgba(0,0,0,0.55)]
        transition-all duration-200
        flex items-center gap-2
        relative overflow-hidden

        before:content-[''] before:absolute before:inset-0
        before:bg-gradient-to-b before:from-white/10 before:via-white/5 before:to-white/0
        before:pointer-events-none

        after:content-[''] after:absolute after:inset-0
        after:bg-[radial-gradient(120%_90%_at_50%_0%,rgba(255,255,255,0.14),transparent_55%)]
        after:pointer-events-none
      `}
    >
      Delete
    </Button>
  </Flex>
);

export default DeleteButton;
