/*
 * Preview-only wrapper for /design-sync cards (cfg.provider).
 *
 * Scaffolding, NOT part of the design system — it supplies the three ambient
 * things Marginalia's components read from their host app, so a card renders
 * the same way the real app renders it:
 *
 *  1. `.register-paper` on <body> — the control system's register class. Every
 *     `--control-*` token (radius, border, shadow, font, press feel) is
 *     defined ONLY under `.register-paper` / `.register-glass`
 *     (controls/registers.css). Without a register ancestor a Button has no
 *     background, border or radius and renders invisible — this is the single
 *     easiest way to get a blank card. Paper is the default register (Desk,
 *     Book, Digest, Settings); Scan components nest their own
 *     `.register-glass` inside, which wins by normal custom-property cascade.
 *  2. A router — NavCluster, LibraryGrid, SettingsModal, SettingsPage and
 *     ReaderPage use <Link>/useNavigate/useParams. MemoryRouter keeps
 *     navigation in memory so a card never touches the URL bar.
 *  3. JobsProvider — TasksTray and JobToastStack read the jobs context via
 *     useJobs() and throw outside a provider.
 *  4. ChromeSlotProvider — NavCluster registers its leading slot through
 *     useRegisterChromeSlot(), which throws ("chromeSlot used outside
 *     ChromeSlotProvider") without it, blanking the whole card.
 *
 * Deliberately outside `src/`, so the app's tsconfig ("include": ["src"])
 * never typechecks it and the app build is untouched.
 */
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { JobsProvider } from "./src/jobs/JobsContext.js";
import { ChromeSlotProvider } from "./src/app/chromeSlot.js";

/*
 * A preview card has no server behind it. Components that read the app's own
 * API (JobsProvider's `/api/jobs`, and the settings readouts) would otherwise
 * render their empty or error state forever, which makes a card that is
 * technically honest and completely useless as a reference.
 *
 * So: stub exactly the GET endpoints the synced components call, with data
 * shaped by the real zod schemas in @marginalia/shared. Anything not listed
 * falls through to the real fetch and fails as it would anyway — the stub
 * never invents an endpoint the app does not have. `/api/jobs/events` is an
 * EventSource, not fetch, so it simply never connects; the tray still renders
 * from the initial GET, which is exactly the reload-mid-run path.
 */
/* Two profiles on purpose: a hosted keyed provider and a local
   openai-compatible one, which are the two branches ProviderPicker's UI has.
   Role assignments embed the whole profile (ProviderRoleAssignment.profile),
   not just its id. */
const PROFILES = [
    {
      id: "p1",
      name: "Claude (subscription)",
      provider: "anthropic",
      anthropicModel: "claude-sonnet-4",
      anthropicApiKey: "sk-ant-••••••••••••4f21",
      claudeAgentModel: "claude-sonnet-4",
      openaiBaseUrl: "",
      openaiModel: "",
      openaiApiKey: "",
      openaiContextTokens: 128000,
      createdAt: "2024-04-02T09:00:00.000Z",
      updatedAt: "2024-05-14T18:20:00.000Z",
    },
    {
      id: "p2",
      name: "Local Qwen3",
      provider: "openai-compatible",
      anthropicModel: "",
      anthropicApiKey: "",
      claudeAgentModel: "",
      openaiBaseUrl: "http://127.0.0.1:11434/v1",
      openaiModel: "qwen3:8b",
      openaiApiKey: "",
      openaiContextTokens: 32768,
      createdAt: "2024-04-28T14:10:00.000Z",
      updatedAt: "2024-05-15T08:05:00.000Z",
    },
  ];

const STUBBED_GETS: Record<string, unknown> = {
  // SettingsPage loads the whole settings bag before rendering its tabs;
  // without it the page is just its heading. Shaped by SettingsSchema
  // (+ AudioSettingsSchema).
  "/api/settings": {
    vaultPath: "~/Documents/Obsidian/Marginalia",
    cursorStyle: "custom",
    cursorTrailEnabled: true,
    spreadMode: "auto",
    pageTransition: "curl",
    readerMargin: "normal",
    readerFontScale: 1.05,
    scanCrtIntensity: 0.6,
    pageNumberMode: "book",
    readerPaneWidth: 720,
    digestTokenBudget: 0,
    ttsEngine: "kokoro",
    ttsModelPath: "~/.marginalia/models/kokoro",
    audioDefaultVoice: "af_heart",
    audioAutoTurnPages: true,
  },
  // AudioTab's voice list.
  "/api/audio/voices": [
    { id: "af_heart", label: "Heart (US, warm)" },
    { id: "af_bella", label: "Bella (US)" },
    { id: "bm_george", label: "George (UK)" },
  ],
  "/api/provider-profiles": PROFILES,
  "/api/provider-roles": [
    { role: "query", profileId: "p1", profile: PROFILES[0], configured: true, maxResponseTokens: 16384 },
    { role: "digest", profileId: "p2", profile: PROFILES[1], configured: true, maxResponseTokens: 8192 },
  ],
  // ProviderPicker reads the profile list and the per-role assignments.
  // Two profiles on purpose: a hosted keyed provider and a local
  // openai-compatible one, which are the two branches its UI has.
  // UsageDivider reads the whole summary in one GET; shaped by
  // UsageSummarySchema (today / last7Days / lastDigest / planLimits).
  "/api/usage/summary": {
    today: {
    inputTokens: 184320,
    outputTokens: 21440,
    billedCostUsd: 1.84,
    notionalCostUsd: 0,
    callCount: 42,
    provenance: "reported",
    byBookAndOperation: [
      { resourceId: "res-1", resourceTitle: "The Feeling of Knowing", operation: "digest", role: "digest", provider: "anthropic", model: "claude-sonnet-4", profileId: "p1", inputTokens: 120000, outputTokens: 9800, cacheReadTokens: 0, durationMs: 41200, costUsd: 1.21, costBasis: "billed", provenance: "reported", callCount: 3 },
      { resourceId: "res-1", resourceTitle: "The Feeling of Knowing", operation: "thread", role: "query", provider: "anthropic", model: "claude-sonnet-4", profileId: "p1", inputTokens: 48320, outputTokens: 9200, cacheReadTokens: 12000, durationMs: 18800, costUsd: 0.51, costBasis: "billed", provenance: "reported", callCount: 12 },
      { resourceId: "res-2", resourceTitle: "Interleaving", operation: "thematic", role: "digest", provider: "openai-compatible", model: "local/qwen3", profileId: "p2", inputTokens: 16000, outputTokens: 2440, cacheReadTokens: 0, durationMs: 52000, costUsd: null, costBasis: "none", provenance: "measured", callCount: 4 },
    ],
  },
    last7Days: {
      inputTokens: 921600,
      outputTokens: 104200,
      billedCostUsd: 9.42,
      notionalCostUsd: 3.10,
      callCount: 216,
      provenance: "mixed",
      byBookAndOperation: [
        { resourceId: "res-1", resourceTitle: "The Feeling of Knowing", operation: "digest", role: "digest", provider: "anthropic", model: "claude-sonnet-4", profileId: "p1", inputTokens: 640000, outputTokens: 52000, cacheReadTokens: 180000, durationMs: 210000, costUsd: 6.40, costBasis: "billed", provenance: "reported", callCount: 18 },
        { resourceId: "res-1", resourceTitle: "The Feeling of Knowing", operation: "thread", role: "query", provider: "anthropic", model: "claude-sonnet-4", profileId: "p1", inputTokens: 210000, outputTokens: 38000, cacheReadTokens: 64000, durationMs: 96000, costUsd: 3.02, costBasis: "billed", provenance: "reported", callCount: 141 },
        { resourceId: "res-2", resourceTitle: "Interleaving", operation: "thematic", role: "digest", provider: "openai-compatible", model: "local/qwen3", profileId: "p2", inputTokens: 71600, outputTokens: 14200, cacheReadTokens: 0, durationMs: 302000, costUsd: null, costBasis: "none", provenance: "measured", callCount: 57 },
      ],
    },
    lastDigest: {
      resourceId: "res-1",
      resourceTitle: "The Feeling of Knowing",
      costUsd: 1.21,
      inputTokens: 120000,
      outputTokens: 9800,
      provenance: "reported",
      createdAt: "2024-05-15T11:52:00.000Z",
    },
    planLimits: [
      {
        role: "query",
        profileName: "Claude (subscription)",
        provider: "anthropic",
        windows: [
          { label: "5-hour", utilization: 0.42, resetsAt: "2024-05-15T15:00:00.000Z" },
          { label: "weekly", utilization: 0.18, resetsAt: "2024-05-19T00:00:00.000Z" },
        ],
        isLocal: false,
        contextTokens: 200000,
        lastCall: null,
      },
      {
        role: "digest",
        profileName: "Local Qwen3",
        provider: "openai-compatible",
        windows: null,
        isLocal: true,
        contextTokens: 32768,
        lastCall: { tokensUsed: 18440, contextPercent: 0.56, tokensPerSecond: 47.2, provenance: "measured" },
      },
    ],
  },

  // ContextLadderToggle reads its current rung per resource; one stub per
  // rung so each story can show a different one.
  "/api/resources/res-digest/context-ladder": { depth: "digest" },
  "/api/resources/res-full/context-ladder": { depth: "full" },
  "/api/resources/res-off/context-ladder": { depth: "off" },
  "/api/jobs": [
    {
      id: "job-digest-1",
      kind: "digest",
      resourceId: "res-1",
      resourceTitle: "The Feeling of Knowing",
      detail: "S3 · The Illusion of Explanatory Depth",
      status: "running",
      progress: { current: 4, total: 6, message: "S4 · Desirable Difficulty" },
      error: null,
      startedAt: "2024-05-15T11:58:00.000Z",
      finishedAt: null,
    },
    {
      id: "job-audio-1",
      kind: "audio-render",
      resourceId: "res-1",
      resourceTitle: "The Feeling of Knowing",
      detail: "S1 · What Knowing Feels Like",
      status: "completed",
      progress: { current: 12, total: 12, message: null },
      error: null,
      startedAt: "2024-05-15T11:40:00.000Z",
      finishedAt: "2024-05-15T11:52:00.000Z",
    },
    {
      id: "job-thematic-1",
      kind: "thematic",
      resourceId: "res-2",
      resourceTitle: "Interleaving",
      detail: null,
      status: "failed",
      progress: { current: 2, total: 9, message: null },
      error: "Provider returned 429 — rate limited",
      startedAt: "2024-05-15T11:30:00.000Z",
      finishedAt: "2024-05-15T11:31:00.000Z",
    },
  ],
};

if (typeof window !== "undefined" && !("__dsFetchStubbed" in window)) {
  (window as unknown as Record<string, unknown>).__dsFetchStubbed = true;
  const real = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    if (method === "GET" && path in STUBBED_GETS) {
      return Promise.resolve(
        new Response(JSON.stringify(STUBBED_GETS[path]), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return real(input as RequestInfo, init);
  };
}

/*
 * Why the <style> block below exists.
 *
 * `package-capture.mjs` freezes the page clock (`page.clock.setFixedTime`) so
 * screenshots are deterministic. `motion` drives its entrance animations off
 * rAF/`performance.now()`, so with the clock frozen those animations never
 * advance: any component whose root is a `motion.div` with
 * `initial={{ opacity: 0 }}` keeps its initial inline `opacity: 0` and
 * screenshots completely blank — SliderDial, NavCluster, JobToastStack,
 * TasksTray, ProgressPopover, AskPill, ChapterNav and the pages all do this.
 * The component is fine; only the frozen-clock capture sees it mid-entrance.
 *
 * So: force any element whose *inline* style is mid-entrance to its resting
 * state. Matching `opacity: 0;` with the trailing semicolon is deliberate —
 * `[style*="opacity: 0"]` would also match `opacity: 0.5;`. Class-based
 * hidden states are untouched (KeyCapAnchor's keycap is `opacity: 0` in a
 * stylesheet, so its resting story still renders hidden, correctly).
 */
const SETTLE_ENTRANCE_ANIMATIONS = `
  [style*="opacity: 0;"] { opacity: 1 !important; transform: none !important; }
`;

/* Injected into <head>, NOT rendered inside the card. A <style> element in
   the card's own tree counts as child content and non-empty textContent,
   which suppresses the converter's floor-card fallback: a component that
   legitimately renders nothing (ServerStatusBanner when the server is fine)
   would show an empty card instead of the honest "preview not yet authored"
   floor. */
if (typeof document !== "undefined" && !document.getElementById("ds-settle-style")) {
  const el = document.createElement("style");
  el.id = "ds-settle-style";
  el.textContent = SETTLE_ENTRANCE_ANIMATIONS;
  document.head.appendChild(el);
  // The register class goes on <body>, not on a wrapper element inside the
  // card. A wrapper would make the card root always report one child, which
  // defeats the converter's floor-card detection ("no children and no text")
  // — a component that legitimately renders nothing would show an empty card
  // instead of the honest "preview not yet authored" floor.
  // `document.body` is null when the bundle is evaluated outside a rendered
  // page (the converter's export-evidence check does exactly that), so guard
  // it and fall back to DOMContentLoaded — an unguarded access throws at
  // module scope and window.Marginalia never gets assigned at all.
  const markBody = () => document.body?.classList.add("register-paper");
  if (document.body) markBody();
  else document.addEventListener("DOMContentLoaded", markBody, { once: true });
}

export function DesignSystemPreview({ children }: { children?: ReactNode }) {
  return (
    <MemoryRouter>
      <ChromeSlotProvider>
        {/* Context providers only — no DOM of our own, so the card root
            contains exactly what the component rendered. */}
        <JobsProvider>{children}</JobsProvider>
      </ChromeSlotProvider>
    </MemoryRouter>
  );
}
