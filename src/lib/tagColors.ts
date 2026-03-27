export interface TagColor {
  bg: string;
  text: string;
}

const TAG_COLORS_DARK: TagColor[] = [
  { bg: "#1a2332", text: "#60a5fa" }, // blue
  { bg: "#1e1b2e", text: "#a78bfa" }, // purple
  { bg: "#052e16", text: "#4ade80" }, // green
  { bg: "#2a1215", text: "#f87171" }, // red
  { bg: "#1c1917", text: "#fbbf24" }, // yellow
  { bg: "#0c1a2e", text: "#38bdf8" }, // cyan
  { bg: "#2a1a0e", text: "#fb923c" }, // orange
  { bg: "#042f2e", text: "#2dd4bf" }, // teal
  { bg: "#1a1a1a", text: "#a8a8a8" }, // gray
];

const TAG_COLORS_LIGHT: TagColor[] = [
  { bg: "#dbeafe", text: "#1d4ed8" },
  { bg: "#ede9fe", text: "#6d28d9" },
  { bg: "#dcfce7", text: "#15803d" },
  { bg: "#fee2e2", text: "#b91c1c" },
  { bg: "#fef3c7", text: "#92400e" },
  { bg: "#cffafe", text: "#0e7490" },
  { bg: "#ffedd5", text: "#c2410c" },
  { bg: "#ccfbf1", text: "#0f766e" },
  { bg: "#f3f4f6", text: "#6b7280" },
];

function tagHash(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 9;
}

export function getTagColor(name: string, dark: boolean): TagColor {
  const index = tagHash(name);
  return dark ? TAG_COLORS_DARK[index] : TAG_COLORS_LIGHT[index];
}
