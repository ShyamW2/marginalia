#!/usr/bin/env node
/**
 * M44's gate (DESKTOP.md §5): a throwaway launcher that starts the bundled
 * server and opens the default browser on it — proving relocatable data,
 * bundled assets and port handling end to end, with no Electron, no
 * packaging and no notarization. **Not the deliverable** — a browser tab
 * fails the hand-it-to-a-friend test, and Safari doesn't render what this
 * app is developed against. Do not ship this.
 *
 * Usage (after `pnpm build`):
 *   node scripts/launch-preview.mjs
 *   MARGINALIA_DATA_DIR=/tmp/scratch node scripts/launch-preview.mjs
 *
 * Copy this file alongside a built tree (server/dist, web/dist) to prove
 * the tree also boots from somewhere other than this checkout.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = spawn(process.execPath, [path.join(root, "server", "dist", "index.js")], {
  env: { ...process.env, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "inherit"],
});

const LISTENING = /listening on (http:\/\/localhost:\d+)/;
let opened = false;

server.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  if (opened) return;
  const match = LISTENING.exec(chunk.toString());
  if (!match) return;
  opened = true;
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [match[1]], { stdio: "ignore", detached: true }).unref();
});

process.on("SIGINT", () => server.kill());
process.on("SIGTERM", () => server.kill());
