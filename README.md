# Marginalia

A local reading environment. You read an EPUB, highlight a passage, and talk to a
language model about it inline — like comments in a Google Doc rather than a chat window
next to the book. The distilled results compile into an Obsidian vault.

The organising constraint is that **the highlight is the prompt**: there is no
free-floating chat box. Every conversation starts from something you selected in the
text, which is also what keeps the answers grounded in the book rather than in the
model's memory of the book.

It runs entirely on your machine — your books, a SQLite file, and your vault folder. The
only thing that leaves your computer is the model call itself, to whichever provider you
configure.

### Status, honestly

This is a personal project that works well for the person who wrote it, and it has never
been installed by anyone else. The install path below was verified on a clean clone, but
the first time a stranger runs it, something will be wrong. Please open an issue when it
is.

See [What is not verified](#what-is-not-verified) before assuming a feature works.

## Requirements

| | |
|---|---|
| **Node** | 20 or newer. Developed on 20 and 24. |
| **pnpm** | 10.x. `corepack enable` will pick up the pinned version automatically. |
| **Disk** | ~500MB for `node_modules`, plus your books. Audio adds a large one-time model download on first use. |

npm and yarn will not work — this is a pnpm workspace and depends on pnpm-specific
install behaviour (see the trap below).

## Install and run

```bash
git clone https://github.com/ShyamW2/marginalia.git
cd marginalia/projects/marginalia
pnpm install
pnpm dev
```

Then open **http://localhost:5173**.

`pnpm dev` starts two processes: the API server on `127.0.0.1:5175` and the Vite dev
server on `5173`, which proxies `/api` to it. You want 5173.

To run the built app instead of the dev server:

```bash
pnpm build
pnpm start          # serves the built UI and the API together on 5175
```

### ⚠️ The one install trap

`better-sqlite3` is a native module. **pnpm 10 does not run dependency build scripts
unless they are explicitly allowed**, and when its build is skipped the server does not
warn — it crashes at startup with `ERR_DLOPEN_FAILED` or a missing bindings file.

This is already handled by `onlyBuiltDependencies` in `pnpm-workspace.yaml`, so a normal
`pnpm install` is fine. It is documented here because if you ever see that crash, this is
why, and the fix is `pnpm rebuild better-sqlite3` rather than anything to do with your
code.

A related warning is expected and harmless at install time:

```
Ignored build scripts: core-js, es5-ext, onnxruntime-node, protobufjs, sharp.
```

Those belong to the text-to-speech stack. Everything except audio works without them.

## Your first book

1. Open http://localhost:5173 — this is the Desk.
2. Import an EPUB. A public-domain fixture ships with the repo:
   `projects/marginalia/fixtures/alice-in-wonderland.epub`.
3. Click it to start reading.
4. Select a passage and ask a question about it.

Step 4 needs a model provider, which is the next section.

## Configuring a model

Open **Settings** and create a provider profile. Three kinds exist:

| Provider | What it needs | Notes |
|---|---|---|
| `anthropic` | An Anthropic API key | The straightforward path. You pay per token. |
| `openai-compatible` | A base URL and model name | Anything speaking the OpenAI chat-completions API — LM Studio, Ollama's compatible endpoint, vLLM, OpenRouter. Works fully offline against a local model. |
| `claude-agent` | A working Claude Code login on this machine | Uses your existing subscription instead of an API key. See the caveats below. |

Profiles are assigned to **roles** — `query` (answering while you read) and `digest`
(batch analysis) — so a cheap local model can do bulk work while a stronger one answers
questions.

**API keys are stored in plaintext** in the SQLite database. That is a deliberate
trade-off for a single-user app running on loopback on your own disk, and it is
explicitly not good enough for anything shipped to other people. Do not run this on a
shared machine.

## Where your data lives

Everything is under `projects/marginalia/data/`, which is gitignored and created on first
run:

```
data/
  marginalia.sqlite   highlights, threads, settings, reading state
  library/            content-addressed copies of imported books
  digests/            generated book digests (markdown projection)
  models/             TTS model weights, downloaded on first use
  audio/              rendered audio cache — safe to delete anytime
```

Two things worth knowing:

- **The path is install-relative, not per-user.** Data lives next to the code, so moving
  or re-cloning the repo does not bring your library with it. Back up `data/` before
  moving anything.
- **Imported books are immutable.** Importing snapshots the file by content hash, so
  highlights can never drift when a source file changes. Deleting the original EPUB you
  imported from is safe.

The Obsidian vault is separate — you set its path in Settings, and publishing writes
notes into it. It is a **one-way projection**: Marginalia writes there and never reads
back, so the vault cannot corrupt your annotations, and editing notes in Obsidian will
not update Marginalia.

## Security

**There is no authentication, and there are no users.** The server binds to `127.0.0.1`
on purpose: it is reachable only from your own machine.

Do not change that binding to `0.0.0.0` to read on your phone. The API can read your
library, read and write your vault path, and spend model tokens, and none of it is behind
a login — exposing it to a network hands all of that to anything on that network. If you
want other devices, put it behind a private overlay network like Tailscale rather than
opening the port. The reasoning is in [docs/SHIPPING.md](docs/SHIPPING.md).

## Third-party terms you should know about

Marginalia's own code is MIT (see [LICENSE](LICENSE)). Two dependencies deserve
explicit mention:

- **`@anthropic-ai/claude-agent-sdk` is not open source.** Its license reads
  `© Anthropic PBC. All rights reserved.`, and use is subject to Anthropic's
  [legal agreements](https://code.claude.com/docs/en/legal-and-compliance). It is a
  required runtime dependency of the server, so `pnpm install` will fetch it whether or
  not you intend to use the `claude-agent` provider.
- **`@img/sharp-libvips-*` is LGPL-3.0-or-later**, pulled in transitively by the TTS
  stack. It is unmodified and not redistributed by this repo.

Everything else is MIT, ISC, BSD or Apache-2.0.

The bundled fixture, `alice-in-wonderland.epub`, is Project Gutenberg #11 — public domain
in the USA, distributed under the Project Gutenberg License included inside the file.

## What is not verified

Stated plainly so you do not lose an evening to it. These have only ever run on the
author's machines:

- **The `claude-agent` provider** requires Claude Code installed and logged in locally.
  It deliberately scrubs `ANTHROPIC_API_KEY` from its environment to force subscription
  auth, so it will not silently fall back to an API key.
- **Text-to-speech** runs Kokoro in-process via ONNX. Its native dependencies are among
  the skipped build scripts noted above, and the automated tests do not exercise the real
  ONNX path — so audio is *untested* outside the author's machines, not *known working*.
  First use downloads the `onnx-community/Kokoro-82M-v1.0-ONNX` weights into
  `data/models/`; expect a large one-time download before the first sentence plays.
- **Windows.** Developed on macOS and Linux only. No reason it should fail; nobody has
  tried.

## Repo layout

This repository is structured as a small collection — `projects/<name>/` — built on one
idea: take an existing task and make it more fun, more interactive, and more beautiful.
Marginalia is the only inhabitant so far, which is why it gets the README.

```
projects/marginalia/
  shared/     types and zod schemas shared by both sides
  server/     Express API, SQLite, EPUB parsing, LLM providers, TTS
  web/        React reader UI
  fixtures/   public-domain EPUBs for testing
docs/         design docs and decision log
```

`pnpm test` runs all three packages (about 456 tests).

## Documentation

The `docs/` directory is written for people working *on* the project rather than running
it, and it is unusually complete — including the reasoning behind decisions that turned
out to be wrong.

- [docs/marginalia/PRODUCT.md](docs/marginalia/PRODUCT.md) — what this is for and what is out of scope
- [docs/marginalia/SPEC.md](docs/marginalia/SPEC.md) — architecture, schema, API, seams
- [docs/marginalia/DESIGN.md](docs/marginalia/DESIGN.md) — the interaction and visual system
- [docs/decisions.md](docs/decisions.md) — the decision log, in date order
- [docs/SHIPPING.md](docs/SHIPPING.md) — how this gets distributed, and what stops each step
- [CLAUDE.md](CLAUDE.md) — the settled decisions that constrain all of the above

### On how this was built

Marginalia was built with heavy AI assistance, and the repo does not hide it: design
sessions and implementation sessions are separated, the prompts are committed, the
decision log records what was rejected, and 83 of the commits carry
`Co-Authored-By: Claude` trailers. If you are interested in what that workflow actually
looks like over a few hundred commits rather than in a demo, `docs/` is the more
interesting half of this repository.

## License

MIT — see [LICENSE](LICENSE).
