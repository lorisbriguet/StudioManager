import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Stub out Tauri APIs in test environment
      "@tauri-apps/plugin-sql": path.resolve(__dirname, "./src/__mocks__/tauri-sql.ts"),
      "@tauri-apps/api/core": path.resolve(__dirname, "./src/__mocks__/tauri-api.ts"),
      "@tauri-apps/api/path": path.resolve(__dirname, "./src/__mocks__/tauri-api.ts"),
      "@tauri-apps/api/app": path.resolve(__dirname, "./src/__mocks__/tauri-api.ts"),
      "@tauri-apps/api/webview": path.resolve(__dirname, "./src/__mocks__/tauri-api.ts"),
      "@tauri-apps/plugin-fs": path.resolve(__dirname, "./src/__mocks__/tauri-api.ts"),
      "@tauri-apps/plugin-dialog": path.resolve(__dirname, "./src/__mocks__/tauri-api.ts"),
      "@tauri-apps/plugin-shell": path.resolve(__dirname, "./src/__mocks__/tauri-api.ts"),
      "@tauri-apps/plugin-updater": path.resolve(__dirname, "./src/__mocks__/tauri-api.ts"),
      "@tauri-apps/plugin-process": path.resolve(__dirname, "./src/__mocks__/tauri-api.ts"),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
