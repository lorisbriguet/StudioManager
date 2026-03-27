import { Search, X } from "lucide-react";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function SearchBar({ value, onChange, placeholder, className = "w-64" }: SearchBarProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Search size={16} className="text-muted shrink-0" />
      <div className="relative flex-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus-accent dark:border-gray-600 pr-7"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-gray-900 dark:hover:text-gray-200"
          >
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
