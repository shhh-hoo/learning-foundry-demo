import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

const values = new Map<string, string>();
const storage = {
  get length() { return values.size; },
  clear: () => values.clear(),
  getItem: (key: string) => values.get(key) ?? null,
  key: (index: number) => [...values.keys()][index] ?? null,
  removeItem: (key: string) => { values.delete(key); },
  setItem: (key: string, value: string) => { values.set(key, value); },
};
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
Object.defineProperty(window, "localStorage", { configurable: true, value: storage });

afterEach(cleanup);
