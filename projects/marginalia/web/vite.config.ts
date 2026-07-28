import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { gzipSync } from "node:zlib";

// M17.5: a one-line total (Vite's default reporter only prints per-file
// sizes) so bundle growth is visible at a glance build-over-build, not just
// discoverable by feel three milestones later.
function bundleSizeSummary() {
  return {
    name: "bundle-size-summary",
    apply: "build" as const,
    generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string; source?: string | Uint8Array }>) {
      let files = 0;
      let raw = 0;
      let gzip = 0;
      for (const asset of Object.values(bundle)) {
        const content = asset.type === "chunk" ? asset.code : asset.source;
        if (content === undefined) continue;
        files++;
        const buf = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
        raw += buf.byteLength;
        gzip += gzipSync(buf).byteLength;
      }
      console.log(
        `\n[bundle] ${files} files, ${(raw / 1024).toFixed(0)} KB raw, ${(gzip / 1024).toFixed(0)} KB gzip\n`,
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), bundleSizeSummary()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:5175",
        changeOrigin: true,
      },
    },
  },
});
