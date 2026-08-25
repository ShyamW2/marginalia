import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import fs from "node:fs";
import multer from "multer";
import { getDb } from "./db.js";
import { diagnoseNativeFailure, formatNativeFailure } from "./startupDiagnosis.js";
import { WORKSPACE_ROOT } from "./paths.js";
import { resourcesRouter } from "./routes/resources.js";
import { highlightsRouter } from "./routes/highlights.js";
import { settingsRouter } from "./routes/settings.js";
import { threadsRouter } from "./routes/threads.js";
import { publishRouter } from "./routes/publish.js";
import { notepadRouter } from "./routes/notepad.js";
import { digestRouter } from "./routes/digest.js";
import { providerProfilesRouter, providerRolesRouter } from "./routes/providerProfiles.js";
import { providerAuthRouter } from "./routes/providerAuth.js";
import { usageRouter } from "./routes/usage.js";
import { jobsRouter } from "./routes/jobs.js";
import { audioRouter, castRouter, ttsRouter } from "./routes/audio.js";

const PORT = Number(process.env.PORT ?? 5175);

// Touch the DB at startup so migrations run before we accept requests.
// M22.6 F: a native-module failure here is fatal by design, but its default
// presentation is a stack trace lost in `concurrently`'s interleaved output while Vite
// keeps serving a UI that looks alive. Translate the known shapes into the one command
// that fixes them; re-throw anything we cannot explain rather than guess.
try {
  getDb();
} catch (error) {
  const failure = diagnoseNativeFailure(error);
  if (!failure) throw error;
  // eslint-disable-next-line no-console
  console.error(formatNativeFailure(failure));
  process.exit(1);
}

const app = express();
app.use(express.json());

// M17.5: a cheap, permanent signal against the "settings takes 15s" class of
// regression returning unnoticed — logs any request whose handler runs long,
// without needing a profiler attached ahead of time.
const SLOW_REQUEST_THRESHOLD_MS = 200;
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (ms >= SLOW_REQUEST_THRESHOLD_MS) {
      // eslint-disable-next-line no-console
      console.warn(`[slow] ${req.method} ${req.originalUrl} ${ms.toFixed(1)}ms`);
    }
  });
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/resources", resourcesRouter);
app.use("/api/resources", publishRouter);
app.use("/api/resources", digestRouter);
app.use("/api/highlights", highlightsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/provider-profiles", providerProfilesRouter);
app.use("/api/provider-roles", providerRolesRouter);
app.use("/api/provider-auth", providerAuthRouter);
app.use("/api/usage", usageRouter);
app.use("/api/threads", threadsRouter);
app.use("/api/notepad", notepadRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/resources", audioRouter);
app.use("/api/audio", ttsRouter);
app.use("/api/cast", castRouter);

// Serve the built web app in production. In dev, Vite serves the web app on
// its own port and proxies /api here — this branch is a no-op then.
const webDist = path.join(WORKSPACE_ROOT, "web", "dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // Express 5 / path-to-regexp v8 dropped the bare "*" wildcard — it now
  // requires a named splat parameter.
  app.get("/*splat", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

// 404 for unmatched /api routes.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "not_found" });
});

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  // A too-large upload is an expected client input error, not a server
  // fault — give it a structured code + 413 (per the app's convention of
  // structured error codes over raw messages) instead of falling through
  // to the generic 500 below.
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "file_too_large" });
    return;
  }
  const message = err instanceof Error ? err.message : "internal_error";
  res.status(500).json({ error: message });
};
app.use(errorHandler);

app.listen(PORT, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`marginalia server listening on http://localhost:${PORT}`);
});
