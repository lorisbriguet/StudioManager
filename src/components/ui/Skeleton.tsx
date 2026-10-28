interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
  /** Inline placeholder (a span), for use inside text or a button, e.g. a tab label. */
  inline?: boolean;
}

const roundedMap = {
  sm: "rounded",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
};

export function Skeleton({ width, height = 12, rounded = "md", className = "", inline = false }: SkeletonProps) {
  const Tag = inline ? "span" : "div";
  return (
    <Tag
      aria-hidden={inline || undefined}
      className={`skeleton ${roundedMap[rounded]} ${inline ? "inline-block align-middle" : ""} ${className}`}
      style={{ width, height }}
    />
  );
}
