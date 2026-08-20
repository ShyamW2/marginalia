import { TasksTray } from "@marginalia/web";

/*
 * TasksTray takes no props — it reads the jobs registry from JobsContext.
 * The preview provider seeds that context from a stubbed `GET /api/jobs`
 * (see _ds-preview-provider.tsx), which is the same path a reload-mid-run
 * takes: the registry is the source of truth, so a fresh mount asks it for
 * everything rather than assuming an empty tray.
 *
 * The seeded set is deliberately mixed — one running digest, one completed
 * audio render, one failed thematic pass — so all three job states are on the
 * card at once. `/api/jobs/events` is an EventSource and never connects here,
 * so the tray is static rather than live.
 */
const stage: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  padding: "8px 6px",
  minHeight: 60,
};

/** The tray with work in it: running, completed and failed together. */
export function WithJobs() {
  return (
    <div style={stage}>
      <TasksTray />
    </div>
  );
}
