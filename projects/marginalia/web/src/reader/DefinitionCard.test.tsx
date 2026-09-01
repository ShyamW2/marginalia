import { type RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Definition, ProviderRoleAssignment } from "@marginalia/shared";
import { AskPill } from "./AskPill.js";
import { DefinitionCard } from "./DefinitionCard.js";
import { DEFAULT_KIND_LABELS } from "./highlightKinds.js";

afterEach(cleanup);

// useProviderRoles() (behind the M30 E feedback "look deeper" model picker)
// fetches /api/provider-profiles and /api/provider-roles on mount — stubbed
// globally so every DefinitionCard render below resolves without hitting a
// real network call. Tests that care about the returned shape override this.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] }) as unknown as Response),
  );
});

function card(result: Definition | null, term = "serendipity") {
  return { left: 100, top: 100, term, highlightId: "h1", result };
}

// A real ref works fine too, but the tests below don't exercise dragging —
// framer-motion's dragConstraints only needs *some* RefObject shape.
const noBoundsRef = { current: null } as unknown as RefObject<HTMLDivElement>;

describe("AskPill's Define button", () => {
  function renderPill(exact: string, onDefine = vi.fn()) {
    render(
      <AskPill
        left={0}
        top={0}
        onPickKind={vi.fn()}
        onAsk={vi.fn()}
        onDefine={onDefine}
        definable={exact.split(" ").length <= 4 && exact.length <= 48}
        onPlayFromHere={vi.fn()}
        labels={DEFAULT_KIND_LABELS}
        onLinkQuote={vi.fn()}
      />,
    );
    return screen.getByRole("button", { name: /^Define/ });
  }

  it("is enabled on a term and fires the lookup", () => {
    const onDefine = vi.fn();
    const button = renderPill("serendipity", onDefine);
    expect(button.hasAttribute("disabled")).toBe(false);
    fireEvent.click(button);
    expect(onDefine).toHaveBeenCalledTimes(1);
  });

  it("is disabled — not hidden — on a paragraph, and says why", () => {
    // A control that vanishes reads as a bug; a disabled one with a reason
    // teaches the rule. M30 C: "enabled only when the selection is short
    // enough to be a term".
    const button = renderPill(
      "It is a truth universally acknowledged that a single man in possession of a good fortune",
    );
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toMatch(/word or a short phrase/);
    // The reason has to reach a screen reader too — a disabled button can't
    // be focused, so its tooltip alone is unreachable.
    expect(button.getAttribute("aria-label")).toMatch(/word or a short phrase/);
  });
});

describe("DefinitionCard", () => {
  it("shows a looking-up state instead of a spinner over the text", () => {
    render(
      <DefinitionCard
        state={card(null)}
        onClose={vi.fn()}
        onAsk={vi.fn()}
        onDeepened={vi.fn()}
        appBoundsRef={noBoundsRef}
      />,
    );
    expect(screen.getByText("Looking up…")).toBeTruthy();
  });

  it("attributes a dictionary hit to the dataset", () => {
    render(
      <DefinitionCard
        state={card({
          headword: "serendipity",
          definition: "(noun) good luck in making discoveries",
          source: "dictionary",
          attribution: "WordNet 3.1",
          reason: "",
        })}
        onClose={vi.fn()}
        onAsk={vi.fn()}
        onDeepened={vi.fn()}
        appBoundsRef={noBoundsRef}
      />,
    );
    expect(screen.getByText("(noun) good luck in making discoveries")).toBeTruthy();
    expect(screen.getByText("WordNet 3.1")).toBeTruthy();
  });

  it("attributes a digest-grounded answer to the book, so the two claims never look alike", () => {
    render(
      <DefinitionCard
        state={card({
          headword: "grok",
          definition: "To understand something thoroughly, by intuition.",
          source: "digest",
          attribution: "Stranger in a Strange Land",
          reason: "",
        })}
        onClose={vi.fn()}
        onAsk={vi.fn()}
        onDeepened={vi.fn()}
        appBoundsRef={noBoundsRef}
      />,
    );
    expect(screen.getByText("From the digest of Stranger in a Strange Land")).toBeTruthy();
  });

  it("shows the resolved headword when morphology moved it off the selection", () => {
    render(
      <DefinitionCard
        state={card(
          {
            headword: "run",
            definition: "(verb) move fast on foot",
            source: "dictionary",
            attribution: "WordNet 3.1",
            reason: "",
          },
          "running",
        )}
        onClose={vi.fn()}
        onAsk={vi.fn()}
        onDeepened={vi.fn()}
        appBoundsRef={noBoundsRef}
      />,
    );
    // Defining a different word than the one on the page is only honest if
    // the substitution is visible.
    expect(screen.getByText("run")).toBeTruthy();
  });

  it("distinguishes 'not in the dictionary' from 'no provider connected'", () => {
    const miss: Definition = {
      headword: "zharkovian",
      definition: "",
      source: "",
      attribution: "",
      reason: "not_found",
    };
    const { unmount } = render(
      <DefinitionCard
        state={card(miss, "zharkovian")}
        onClose={vi.fn()}
        onAsk={vi.fn()}
        onDeepened={vi.fn()}
        appBoundsRef={noBoundsRef}
      />,
    );
    expect(screen.getByText(/neither the dictionary nor this book's digest/)).toBeTruthy();
    unmount();

    render(
      <DefinitionCard
        state={card({ ...miss, reason: "no_provider" }, "zharkovian")}
        onClose={vi.fn()}
        onAsk={vi.fn()}
        onDeepened={vi.fn()}
        appBoundsRef={noBoundsRef}
      />,
    );
    // Sending a reader to Settings for a word that simply isn't a word would
    // be the wrong ask — hence two messages, not one.
    expect(screen.getByText(/no LLM provider is connected/)).toBeTruthy();
  });

  it("escalates to a thread only when the reader asks", () => {
    const onAsk = vi.fn();
    render(
      <DefinitionCard
        state={card({
          headword: "serendipity",
          definition: "(noun) good luck",
          source: "dictionary",
          attribution: "WordNet 3.1",
          reason: "",
        })}
        onClose={vi.fn()}
        onAsk={onAsk}
        onDeepened={vi.fn()}
        appBoundsRef={noBoundsRef}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask about this" }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it("offers a deeper search on a dictionary miss instead of running it automatically", async () => {
    // M30 E feedback: a dictionary miss with a provider configured used to
    // fall through to the digest rung on its own. It no longer does — the
    // reader gets asked, via the offer this test looks for, and nothing
    // beyond the roles/profiles GETs (useProviderRoles' own fetch) should
    // have gone out yet.
    const roleAssignment: ProviderRoleAssignment = {
      role: "query",
      profileId: "p1",
      profile: {
        id: "p1",
        name: "Local Qwen",
        provider: "openai-compatible",
        anthropicModel: "",
        anthropicApiKey: "",
        claudeAgentModel: "",
        codexModel: "",
        openaiBaseUrl: "http://localhost:11434",
        openaiModel: "qwen3.5",
        openaiApiKey: "",
        openaiContextTokens: 32768,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      configured: true,
      maxResponseTokens: 2000,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (url.includes("provider-roles") ? [roleAssignment] : []),
      })) as unknown as typeof fetch,
    );

    const miss: Definition = {
      headword: "timshel",
      definition: "",
      source: "",
      attribution: "",
      reason: "dictionary_miss",
    };
    render(
      <DefinitionCard
        state={card(miss, "timshel")}
        onClose={vi.fn()}
        onAsk={vi.fn()}
        onDeepened={vi.fn()}
        appBoundsRef={noBoundsRef}
      />,
    );

    expect(await screen.findByText(/not in the dictionary/i)).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Look deeper" })).toBeTruthy();
    expect(screen.getByText(/Local Qwen/)).toBeTruthy();
    // The offer, not the search itself: no /definition/deepen call yet.
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/deepen"), expect.anything());
  });
});
