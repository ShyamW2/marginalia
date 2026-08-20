import { useEffect } from "react";
import { JobToastStack, useJobs } from "@marginalia/web";

/*
 * JobToastStack takes no props, and it does NOT show every job — only the
 * ones in `toastIds`, i.e. jobs started *in this tab*. It is the "you just
 * started something" notice; the tray in the nav cluster is the durable view.
 * So seeding the registry via a stubbed `GET /api/jobs` is not enough: the
 * stack correctly renders nothing for jobs it did not see start.
 *
 * This drives the real path instead of faking the markup — `registerStarted`
 * is the exact context call the app makes when a POST returns a jobId.
 *
 * The stack is `position: fixed`; a card renders it inside a transformed
 * wrapper, which becomes the containing block, so it lands in the card
 * rather than escaping to the page viewport.
 */
const stage: React.CSSProperties = {
  position: "relative",
  height: 210,
  borderRadius: 10,
  background: "var(--color-bg)",
  border: "1px dashed var(--color-border)",
  overflow: "hidden",
};

function StartJobs({ jobs }: { jobs: { id: string; kind: "digest" | "audio-render" | "thematic"; resourceId: string | null; resourceTitle: string | null }[] }) {
  const { registerStarted } = useJobs();
  useEffect(() => {
    for (const j of jobs) registerStarted(j);
  }, []);
  return null;
}

/** One job just started — the single-toast case. */
export function JustStarted() {
  return (
    <div style={stage}>
      <StartJobs
        jobs={[{ id: "job-digest-1", kind: "digest", resourceId: "res-1", resourceTitle: "The Feeling of Knowing" }]}
      />
      <JobToastStack />
    </div>
  );
}

/** Several at once — the stack is what makes this a stack rather than a
 *  toast: starting a second job while the first is up adds to the pile. */
export function Stacked() {
  return (
    <div style={stage}>
      <StartJobs
        jobs={[
          { id: "job-digest-1", kind: "digest", resourceId: "res-1", resourceTitle: "The Feeling of Knowing" },
          { id: "job-audio-1", kind: "audio-render", resourceId: "res-1", resourceTitle: "The Feeling of Knowing" },
          { id: "job-thematic-1", kind: "thematic", resourceId: "res-2", resourceTitle: "Interleaving" },
        ]}
      />
      <JobToastStack />
    </div>
  );
}
