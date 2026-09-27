import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/helpers/env.ts"],
    globalSetup: ["tests/helpers/global-setup.ts"],
    // Os testes de integração compartilham o mesmo banco: arquivos rodam em série.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
