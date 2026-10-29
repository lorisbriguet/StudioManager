import { Search } from "lucide-react";
import { useT } from "../../i18n/useT";
import { Input } from "./Input";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** On the wrapper: width (w-64 by default) and layout. */
  className?: string;
}

/** Search field: Input with its search `icon` and `onClear`, 256px wide by default. */
export function SearchBar({ value, onChange, placeholder, className = "w-64" }: SearchBarProps) {
  const t = useT();
  return (
    <Input
      icon={Search}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onClear={() => onChange("")}
      clearLabel={t.clear_search}
      placeholder={placeholder}
      aria-label={placeholder ?? t.search}
      fullWidth={false}
      className={className}
    />
  );
}
