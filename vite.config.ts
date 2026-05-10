import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // App.test.tsx hangs in CI (pre-existing issue, see DEV.md
    // footguns — investigate later). Excluded from the coverage
    // run + the default `npm test` invocation via the per-script
    // flag in package.json. Other tests stay live.
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.{test,spec}.{ts,tsx}",
        "src/test/**",
        "src/main.tsx",
        "src/**/*.d.ts",
      ],
      // Baseline captured at 0.2.250 against current test suite
      // (minus App.test.tsx). CI rounds down by 1pt as a safety
      // margin against coincidental flakes — a real regression
      // beyond that fails the build. Raise these as coverage
      // improves; never lower them.
      thresholds: {
        lines: 38,
        statements: 37,
        branches: 34,
        functions: 30,
      },
    },
  },
});
