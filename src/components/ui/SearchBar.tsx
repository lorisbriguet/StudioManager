import { Search, X } from "lucide-react";
import { useT } from "../../i18n/useT";
import { Input } from "./Input";
import { IconButton } from "./IconButton";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** Search field: Input (26px, like every control) with a search icon and a clear button. */
export function SearchBar({ value, onChange, placeholder, className = "w-64" }: SearchBarProps) {
  const t = useT();
  return (
    <div className={`relative ${className}`}>
      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" aria-hidden="true" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder ?? t.search}
        className="pl-7 pr-7"
      />
      {value && (
        <IconButton
          icon={X}
          label={t.clear_search}
          size="xs"
          onClick={() => onChange("")}
          className="absolute right-1 top-1/2 -translate-y-1/2"
        />
      )}
    </div>
  );
}
