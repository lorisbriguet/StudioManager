import { useEffect, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { useT } from "../../i18n/useT";
import { ICONS, IconButton } from "../ui";

/** How long the button shows "Copied". */
const COPIED_MS = 1500;

/**
 * A code block in an agent's reply, with a copy button in its top-right corner (shown on
 * hover or keyboard focus). Copies the code exactly as shown, without the trailing newline.
 */
export function CodeBlock(props: ComponentPropsWithoutRef<"pre"> & { node?: unknown }) {
  const { node: _node, children, ...rest } = props;
  const t = useT();
  const pre = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = () => {
    const text = (pre.current?.textContent ?? "").replace(/\n$/, "");
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
      },
      () => setCopied(false),
    );
  };

  return (
    <div className="group relative">
      <pre ref={pre} {...rest}>
        {children}
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <IconButton
          size="xs"
          icon={copied ? ICONS.selected : ICONS.copy}
          label={copied ? t.copied : t.copy}
          color={copied ? "accent" : undefined}
          reveal={!copied}
          onClick={copy}
        />
      </div>
    </div>
  );
}
