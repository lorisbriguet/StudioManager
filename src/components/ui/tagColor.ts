import { getStoredTagColor, getTagColor, type TagColor } from "../../lib/tagColors";

/**
 * A tag's colours, shared by Tag and FilterChip. CSS variable strings, so they
 * follow dark mode and themes by themselves.
 *
 *   const { bg, text } = useTagColor("typography");           colour from the name (hash)
 *   const { bg, text } = useTagColor(opt.value, opt.color);   stored colour name
 *
 * Passing `color` (even null) uses the stored colour name instead of the hash.
 * Kept as a hook so callers don't change if it ever needs to read state again.
 */
export function useTagColor(name: string, color?: string | null): TagColor {
  return color !== undefined ? getStoredTagColor(color) : getTagColor(name);
}
