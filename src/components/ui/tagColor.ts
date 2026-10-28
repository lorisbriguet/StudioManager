import { getStoredTagColor, getTagColor, type TagColor } from "../../lib/tagColors";
import { useAppStore } from "../../stores/app-store";

/**
 * A tag's colours for the current theme, shared by Tag and FilterChip.
 *
 *   const { bg, text } = useTagColor("typography");           colour from the name (hash)
 *   const { bg, text } = useTagColor(opt.value, opt.color);   stored colour name
 *
 * Passing `color` (even null) uses the stored colour name instead of the hash.
 */
export function useTagColor(name: string, color?: string | null): TagColor {
  const dark = useAppStore((s) => s.darkMode);
  return color !== undefined ? getStoredTagColor(color, dark) : getTagColor(name, dark);
}
