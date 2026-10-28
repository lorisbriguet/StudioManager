import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { useConfirmStore } from "../stores/confirm-store";

// A confirmation a test left unanswered must not show up in the next test's
// <ConfirmHost/>. (Its promise stays pending; nothing awaits it any more.)
afterEach(() => {
  useConfirmStore.setState({ queue: [] });
});

// Minimal localStorage mock for jsdom
const store: Record<string, string> = {};
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = val;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
  },
});

// matchMedia stub
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
