/** True in the StudioManager Demo build (`npm run build:demo`). The only reader of the env var. */
export function isDemoBuild(): boolean {
  return import.meta.env.VITE_DEMO_BUILD === "1";
}
