import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "test",
    maxConcurrency: 8,
  },
});
