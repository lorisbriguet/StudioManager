interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: "sm" | "md" | "lg" | "xl" | "full";
  className?: string;
}

const roundedMap = {
  sm: "rounded",
  md: "rounded-md",
  lg: "rounded-lg",
  xl: "rounded-xl",
  full: "rounded-full",
};

export function Skeleton({ width, height = 12, rounded = "md", className = "" }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${roundedMap[rounded]} ${className}`}
      style={{ width, height }}
    />
  );
}
