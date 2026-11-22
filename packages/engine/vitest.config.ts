import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    alias: {
      "@sim/content": fileURLToPath(new URL("../content/src/index.ts", import.meta.url))
    }
  }
});
