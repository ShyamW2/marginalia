# Marginalia — Product Requirements

*Working name. A local reading environment where marginalia is the interface: highlight
a passage, ask a question, get an inline answer, and let the insights compile into an
Obsidian vault.*

## The core loop

1. **Import** a resource (EPUB first; PDF, Markdown later) into a local, immutable,
   content-addressed library.
2. **Read** it in a beautiful reader — real typography, pagination, remembered position,
   light/dark themes.
3. **Highlight** a passage. A subtle affordance appears (not a modal, not a context-menu
   maze).
4. **Ask** a question about the selection. The question + answer render as a collapsible
   inline thread anchored to the passage — like a Google Docs comment, visually like a
   sticky note in a book. Threads support follow-ups.
5. **Revisit**: reopening the book shows every thread where it lives, a margin rail /
   page indicators making annotated pages discoverable at a glance.
6. **Publish**: a distill step compiles the book's threads into the Obsidian vault —
   one folder per book, plus shared concept notes linked across books.

## What the LLM sees

- The full resource text (or the largest window that fits the model's context), with the
  highlighted passage marked as the focus. Provider-side prompt caching used where
  available so a reading session doesn't re-pay for the book on every question.
- The thread history for follow-ups.
- Never: the vault, other books, or the filesystem. (Cross-book awareness happens at
  distill time, through concept-note matching in code — see below.)

## The vault projection

- One-way: reader SQLite → vault. The vault is never read back for anchoring.
- Per book: `<Vault>/Readings/<Book Title>/` containing a book overview note and one
  note per distilled thread/insight, each quoting the anchored passage and linking back.
- Concepts: `<Vault>/Concepts/<Concept>.md`, MOC-style — one canonical note per concept.
  At distill time the LLM proposes concepts (name, aliases, one-line gloss) as structured
  JSON; **code** fuzzy-matches proposals against existing concept notes and either links
  or creates. Consistent naming, enforced by code, is what makes cross-book association
  work — no embeddings needed in v1.
- Distillation is user-triggered ("publish"), per book or per thread — not automatic on
  every message. Re-publishing is idempotent (stable filenames, regenerate-in-place).

## Architecture (settled)

```
browser UI (reader, threads, library)
        │  HTTP + SSE/WebSocket (streaming answers)
node server
  ├── library        content-addressed resource store (immutable)
  ├── annotations    SQLite: highlights, threads, anchors
  ├── llm            LLMProvider interface → claude | openai-compatible | hermes
  └── vault compiler distill pipeline → Obsidian vault (one-way)
```

- **Anchoring**: W3C Web Annotation style — exact quote + prefix/suffix + EPUB CFI
  position fallback. Unit-tested hard.
- **LLMProvider** (the seam): `stream(messages, opts)` and
  `extract(messages, schema)` — nothing provider-specific escapes. Capability flags
  (context size, caching) let the context builder adapt per provider.

## v1 scope

In: EPUB import/render, highlights, inline Q&A threads (streaming), thread persistence
and revisiting, publish-to-vault with concept linking, provider config (at least Claude +
one OpenAI-compatible endpoint).

Out (explicitly deferred): PDF, Markdown, free-floating chat, two-way vault sync,
embeddings/semantic search, multi-device, OCR, mobile.

## Open questions

- Does a thread ever *start* from the model (proactive margin notes), or is v1 strictly
  user-initiated? (Leaning: strictly user-initiated.)
- Highlight colors / kinds (question vs. mark-for-later) — v1 or later?
- How much of the reading surface is pagination vs. scroll? (Prototype both, feel wins.)
