# Kickoff prompt for the implementation model (Sonnet)

Paste the block below as the first message of an implementation session (e.g. after
`/model sonnet`). It also works verbatim for resumed sessions — progress lives in
TASKS.md checkboxes and git history, not in conversation memory.

---

You are implementing **Marginalia**, a local reading app where highlighting a passage
and asking a question creates an inline LLM thread, later compiled into an Obsidian
vault. The architecture and product decisions are already made by a prior design
session — your job is disciplined execution, not redesign.

**Read these first, in order:**
1. `CLAUDE.md` — philosophy, settled decisions, discipline (binding)
2. `docs/marginalia/SPEC.md` — prescriptive implementation spec (binding)
3. `docs/marginalia/TASKS.md` — ordered task list with acceptance criteria
4. `docs/marginalia/PRODUCT.md` — product context (background)
5. `docs/decisions.md` — the entry your milestone names (M11–M16 → 2026-07-20;
   M14–M18 → 2026-07-27; M39–M41 → 2026-09-03, both entries). It resolves the "make it
   feel like X" notes into rules; don't re-derive them.
6. `docs/marginalia/DESIGN.md` (binding for M7+); for M17+ only,
   `docs/marginalia/AUDIO.md` (binding for the audio subsystem); and for **M39–M41 only,
   `docs/marginalia/PDF.md` (binding)** — read it in full before the first task, not
   section by section as you reach them. Its traps are cross-cutting: §2 governs resource
   identity, §4 the spine, and §7 the renderer seam, and getting §4 wrong is not visible
   until the digest and scan are built on top of it.

**How to work:**
- Find the first unchecked task in TASKS.md and do exactly that task. Small, focused
  commits (`M2: restore reading position on open`), one or a few tasks per commit.
  Check the box in TASKS.md in the same commit.
- Avoid monkey patching when writing, code with the Boy Scout Rule, and when editing let's make changes that keep the code readable and easily editable. 
- Complete each milestone's **Verify** step for real — run the app, exercise the flow
  with a fixture EPUB — before starting the next milestone. If verification fails,
  fixing it is your current task.
- **Do not re-decide settled decisions** (stack, seams, data model, one-way vault,
  provider-agnostic layer). If the SPEC seems wrong or is silent on something you
  need, make the most boring choice that satisfies it, mark it `// SPEC-GAP: <why>`,
  and add one line to `docs/marginalia/NOTES.md`. Do not invent new abstractions,
  dependencies, or features beyond the task at hand.
- The SPEC's Anthropic SDK usage (no sampling params, no `thinking` config,
  `cache_control` blocks, `messages.parse` + `zodOutputFormat`) was verified against
  current docs and overrides anything you remember from training. Same for model IDs
  (`claude-opus-4-8`, `claude-sonnet-5`).
- Every LLM JSON output is zod-validated; a parse failure is a handled state. No
  provider SDK types outside `server/src/llm/`.
- Write the unit tests the SPEC and TASKS name — they're part of the task, not
  optional. `pnpm test` must pass at every commit.
- UI quality is an acceptance criterion (CLAUDE.md discipline): typography, dark mode,
  motion, empty states. "Works but looks clumsy" is not done.
- If truly blocked (missing credential, contradictory requirements), write the
  blocker to `docs/marginalia/NOTES.md` under `## Blockers`, skip to the next
  non-dependent task if one exists, otherwise stop and report.

Start now: read the four documents, then begin with the first unchecked task in
TASKS.md.

---

## Operator notes (for the human, not the model)

- **Model choice:** `/model sonnet` (Sonnet 4.6) or `claude-sonnet-5` both work for
  this grunt work; escalate a single stuck task to Opus/Fable rather than the whole
  session.
- **Credentials:** M4's manual verification needs `ANTHROPIC_API_KEY` (and optionally
  an OpenAI-compatible endpoint). Everything else runs offline.
- **Review cadence:** review at milestone boundaries (git log per milestone). Good
  checkpoints for a `/code-review`: end of M3 (anchoring), M4 (provider layer), M6
  (vault safety).
- Design-session decisions live in `docs/decisions.md`; if implementation reveals a
  bad decision, bring it back to a design session (Fable/Opus) instead of letting the
  implementation model drift from it.
