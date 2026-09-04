import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/ = Fortnox-mapper + periodpivot, lib/__tests__ = beläggning.
    include: ["tests/**/*.test.ts", "lib/**/*.test.ts"],
    environment: "node",
  },
});
