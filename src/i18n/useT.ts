import { useAppStore } from "../stores/app-store";
import { uiLabels } from "./ui";

export function useT() {
  const lang = useAppStore((s) => s.language);
  return uiLabels[lang];
}
