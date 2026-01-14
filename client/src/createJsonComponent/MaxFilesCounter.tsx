import React from "react";
import { Button, InputNumber, Switch } from "antd";

export const Counter: React.FC<{
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}> = ({ value, min, max, step = 1, disabled, onChange }) => {
  const clamp = (n: number) => {
    if (typeof max === "number") n = Math.min(n, max);
    if (typeof min === "number") n = Math.max(n, min);
    return n;
  };
  const change = (n: number) => onChange(clamp(n));
  const atMin = typeof min === "number" ? value <= min : false;
  const atMax = typeof max === "number" ? value >= max : false;

  return (
    <div
      className={`inline-flex items-stretch rounded-xl overflow-hidden border bg-white shadow-sm ${
        disabled ? "opacity-60" : "border-neutral-200"
      }`}
    >
      <Button
        type="text"
        size="small"
        className="!px-2 !h-8 font-hebrew text-base leading-none hover:!bg-neutral-50"
        onClick={() => change(value - step)}
        disabled={disabled || atMin}
        aria-label="minus"
      >
        −
      </Button>
      <InputNumber
        controls={false}
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(n) => change(typeof n === "number" ? n : value)}
        className="font-hebrew !text-center !border-0 !rounded-none !py-0.5 !h-8 !text-sm w-10 focus:!shadow-none"
      />
      <Button
        type="text"
        size="small"
        className="!px-2 !h-8 font-hebrew text-base leading-none hover:!bg-neutral-50"
        onClick={() => change(value + step)}
        disabled={disabled || atMax}
        aria-label="plus"
      >
        +
      </Button>
    </div>
  );
};

export const HasSwitch: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  checkedText: string;
  uncheckedText: string;
}> = ({ checked, onChange, checkedText, uncheckedText }) => {
  return (
    <Switch
      className="font-hebrew"
      checked={checked}
      onChange={onChange}
      checkedChildren={checkedText}
      unCheckedChildren={uncheckedText}
    />
  );
};