import React, { useEffect } from "react";
import { Input } from "antd";

const { TextArea } = Input;

type Props = {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholderText: string;
  className?: string;
  autoSize?: { minRows?: number; maxRows?: number };
  speedMs?: number;
  endPauseMs?: number;
  cursor?: boolean;
  disabled?: boolean;
  rows?: number;
  emphasizeTerms?: string[];
};

const AnimatedPlaceholderTextArea: React.FC<Props> = ({
  value,
  onChange,
  placeholderText,
  className,
  autoSize,
  speedMs = 65,
  endPauseMs = 900,
  cursor = true,
  disabled,
  rows,
  emphasizeTerms = [],
}) => {
  const [ph, setPh] = React.useState("");
  const [cursorOn, setCursorOn] = React.useState(true);
  const [focused, setFocused] = React.useState(false);
  const indexRef = React.useRef(0);
  const timerRef = React.useRef<number | null>(null);
  const pauseRef = React.useRef<number | null>(null);
  const blinkRef = React.useRef<number | null>(null);

  const active = !focused && !value;

  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const escapeRegex = (s: string) =>
    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const highlightTerms = (raw: string) => {
    if (!emphasizeTerms.length) return escapeHtml(raw);

    const pattern = new RegExp(
      "(" + emphasizeTerms.map(escapeRegex).join("|") + ")",
      "g"
    );

    let lastIndex = 0;
    let out = "";
    let m: RegExpExecArray | null;

    while ((m = pattern.exec(raw)) !== null) {
      const [match] = m;
      const start = m.index;
      const end = start + match.length;

      if (start > lastIndex) {
        out += escapeHtml(raw.slice(lastIndex, start));
      }
      out += `<strong><u>${escapeHtml(match)}</u></strong>`;
      lastIndex = end;
    }

    if (lastIndex < raw.length) {
      out += escapeHtml(raw.slice(lastIndex));
    }

    return out;
  };

  useEffect(() => {
    const clearTimers = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (pauseRef.current) window.clearTimeout(pauseRef.current);
    };

    if (!active) {
      clearTimers();
      setPh("");
      indexRef.current = 0;
      return () => clearTimers();
    }

    const typeNext = () => {
      const i = indexRef.current;
      if (i < placeholderText.length) {
        const typed = placeholderText.slice(0, i + 1);
        setPh(typed); 
        indexRef.current = i + 1;
        timerRef.current = window.setTimeout(typeNext, speedMs);
      } else {
        pauseRef.current = window.setTimeout(() => {
          indexRef.current = 0;
          setPh("");
          timerRef.current = window.setTimeout(typeNext, speedMs);
        }, endPauseMs);
      }
    };

    typeNext();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (pauseRef.current) window.clearTimeout(pauseRef.current);
    };
  }, [active, placeholderText, speedMs, endPauseMs]);

  useEffect(() => {
    if (!cursor || !active) {
      if (blinkRef.current) window.clearInterval(blinkRef.current);
      setCursorOn(true);
      return;
    }
    blinkRef.current = window.setInterval(() => setCursorOn((c) => !c), 500);
    return () => {
      if (blinkRef.current) window.clearInterval(blinkRef.current);
    };
  }, [cursor, active]);

  const showOverlay = active && ph;
  const overlayHtml =
    highlightTerms(ph) + (cursor && active ? (cursorOn ? " │" : "  ") : "");

  return (
    <div className="relative w-full">
      <TextArea
        className={className}
        style={{ width: "100%" }}
        value={value}
        onChange={onChange}
        placeholder={showOverlay ? "" : undefined}
        autoSize={autoSize}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={disabled}
        rows={rows}
      />
      {showOverlay && (
        <div
          className="pointer-events-none absolute inset-0 px-3 py-2 text-neutral-400 whitespace-pre-wrap font-normal"
          dangerouslySetInnerHTML={{ __html: overlayHtml }}
        />
      )}
    </div>
  );
};

export default AnimatedPlaceholderTextArea;