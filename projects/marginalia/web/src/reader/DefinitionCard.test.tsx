import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Definition } from "@marginalia/shared";
import { AskPill } from "./AskPill.js";
import { DefinitionCard } from "./DefinitionCard.js";
import { DEFAULT_KIND_LABELS } from "./highlightKinds.js";

afterEach(cleanup);

function card(result: Definition | null, term = "serendipity") {
  return { left: 100, top: 100, term, highlightId: "h1", result };
}

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
    render(<DefinitionCard state={card(null)} onClose={vi.fn()} onAsk={vi.fn()} />);
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
      <DefinitionCard state={card(miss, "zharkovian")} onClose={vi.fn()} onAsk={vi.fn()} />,
    );
    expect(screen.getByText(/neither the dictionary nor this book's digest/)).toBeTruthy();
    unmount();

    render(
      <DefinitionCard
        state={card({ ...miss, reason: "no_provider" }, "zharkovian")}
        onClose={vi.fn()}
        onAsk={vi.fn()}
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
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask about this" }));
    expect(onAsk).toHaveBeenCalledTimes(1);
  });
});
