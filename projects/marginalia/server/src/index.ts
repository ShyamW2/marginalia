import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import path from "node:path";
import fs from "node:fs";
import { getDb } from "./db.js";
import { WORKSPACE_ROOT } from "./paths.js";
import { resourcesRouter } from "./routes/resources.js";
import { highlightsRouter } from "./routes/highlights.js";

const PORT = Number(process.env.PORT ?? 5175);

// Touch the DB at startup so migrations run before we accept requests.
getDb();

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/resources", resourcesRouter);
app.use("/api/highlights", highlightsRouter);

// Serve the built web app in production. In dev, Vite serves the web app on
// its own port and proxies /api here — this branch is a no-op then.
const webDist = path.join(WORKSPACE_ROOT, "web", "dist");
if (process.env.NODE_ENV === "production" && fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
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
  const message = err instanceof Error ? err.message : "internal_error";
  res.status(500).json({ error: message });
};
app.use(errorHandler);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`marginalia server listening on http://localhost:${PORT}`);
});
