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
| **Node** | 20 or newer. `.nvmrc` pins 24, so `nvm use` picks the developed-against version. |
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
why — and because the server now catches it and prints the fix rather than dying in a
stack trace.

⚠️ **If you fix it by hand, the `-r` is not optional:**

```bash
pnpm rebuild -r better-sqlite3
```

`better-sqlite3` belongs to the `server` workspace package, not the root, so a root-level
`pnpm rebuild better-sqlite3` **matches nothing and exits 0 with no output.** It looks
like it worked and the module is still broken. `pnpm sync` (below) does this correctly.

One warning at install time is expected and harmless:

```
Ignored build scripts: core-js, es5-ext.
```

Both are postinstall scripts that only print donation notices. Nothing needs them.

## Updating

```bash
cd projects/marginalia     # the cd matters — see below
pnpm sync
```

That is the whole thing. It pulls, and then does only what is actually needed:

| It checks | And acts only if |
|---|---|
| the lockfile hash | it changed → `pnpm install` |
| the Node ABI | you changed Node major → rebuilds the native modules |

It prints what it did, and running it twice tells you the second run did nothing. Use
`pnpm sync --no-pull` if you have already pulled, or you are offline.

⚠️ **Run it from `projects/marginalia`, not the repository root.** There is no
`package.json` at the root, so pnpm finds no script by that name and falls through to
the **`sync` command that ships with your OS** — which prints `Usage: sync [OPTION]...`
and exits 0. It looks like it ran and nothing happened.

**You usually don't even need that.** `pnpm dev` watches the filesystem, so a plain
`git pull` is normally enough on its own: the server restarts, the browser hot-reloads,
and any new database migrations apply automatically the next time the server boots. You
do not need to stop `pnpm dev`, and you do not need to re-run it.

`pnpm sync` exists for the two cases where that is *not* enough — a changed dependency
and a changed Node version — because both of them fail by killing the server at startup,
and neither announces which one it was.

### If something looks broken after an update

The old failure mode was confusing: the server would die, but Vite kept serving, so the
app still rendered and only the API calls failed. It looked like it was running.

That no longer happens quietly:

- **The browser** shows a banner when the server stops answering, and clears it by itself
  when the server comes back. A normal watch-restart will not trigger it.
- **The terminal** prints what is wrong and the exact command that fixes it, instead of a
  stack trace — whether the native module was never compiled, was built for a different
  Node version, or came from a different machine.

In nearly every case the answer is `pnpm sync`.

### ⚠️ Your library does not travel with you

Updating the *code* on a second machine does not bring your *books* with it. `data/` is
per-machine and gitignored, so libraries, highlights, threads and reading position are
entirely separate on each install. Highlighting a passage on one machine will not show up
on another.

That is a deliberate limitation, not a bug — see
[docs/SHIPPING.md](docs/SHIPPING.md) for what changing it would take.

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
| `claude-agent` | A Claude Pro or Max subscription, and the `claude` CLI installed | Uses your existing subscription instead of an API key. See "Subscription providers" below. |
| `codex-cli` | A ChatGPT paid plan, and the `codex` CLI installed | Same idea for OpenAI. Runs caged: read-only sandbox, ephemeral, in a scratch directory. See below. |

Profiles are assigned to **roles** — `query` (answering while you read) and `digest`
(batch analysis) — so a cheap local model can do bulk work while a stronger one answers
questions.

### Subscription providers (`claude-agent`, `codex-cli`)

These two are the finicky ones, and they are finicky for a reason that has nothing to do
with the model: they are not configured by pasting a key into a field. They have **three
preconditions**, and each one fails with a different symptom.

| | `codex-cli` | `claude-agent` |
|---|---|---|
| **1. Subscription** | ChatGPT Plus, Pro, Business, Edu or Enterprise | Claude Pro or Max |
| **2. CLI installed** | `npm install -g @openai/codex` | `npm install -g @anthropic-ai/claude-code` |
| **3. Signed in** | **Settings → LLM → Accounts → Sign in** | same |
| Where the login is kept | `~/.codex/auth.json` (or `~/snap/codex/current/auth.json` for the snap build) | `~/.claude/` |

Precondition 2 is about **the machine running the server**, not the machine running the
browser. If you reach Marginalia over your LAN from a laptop, the CLI has to be installed
on the box running `pnpm dev`.

Marginalia never stores, copies or caches these credentials. It shells out to the CLI you
already have and asks it, every time — which is the whole reason there is no second
secret store here to worry about, unlike the API keys above.

**Signing in.** Use the Accounts panel rather than a terminal. Codex prints a short code
and a verification URL; open that URL on any device — phone included — and the panel
switches to Connected on its own. Nothing listens on a callback port, so the browser and
the server do not have to be on the same machine.

**You should only ever do this once per machine.** The sign-in survives restarts,
rebuilds and reboots. If Marginalia keeps asking you to sign in again, that is a bug in
Marginalia, not an expired login — open an issue rather than re-authenticating, because
a rapid series of sign-ins on one account is exactly the pattern that looks like abuse.
(One such bug was fixed on 2026-08-26: `codex login status` prints its answer on stderr,
and the status check was reading stdout only.)

#### `spawn codex ENOENT`, or `spawn claude ENOENT`

This almost never means the CLI is missing. It means Marginalia's server can't see it.

`spawn` searches only the `PATH` of whatever launched the server, and on macOS a process
not started from a login shell gets the bare `/usr/bin:/bin:/usr/sbin:/sbin` — in which
Homebrew, npm-global, nvm, volta and bun installs are all invisible. So `codex` works
perfectly in your terminal and is nowhere to be found from the app.

Marginalia searches `PATH`, then the directories these CLIs actually install into, then
asks your login shell directly. If all three miss, override it:

```bash
which codex                                   # in your normal terminal
MARGINALIA_CODEX_BIN=/opt/homebrew/bin/codex pnpm dev
```

`MARGINALIA_CLAUDE_BIN` does the same for Claude Code. **Settings → LLM → Accounts →
"How to connect"** shows you which of these applies on your machine — the resolved path
and version when it worked, or every directory searched when it didn't.

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
- **Text-to-speech** runs Kokoro in-process via ONNX. Its native dependencies now build
  and load correctly on install (verified on Linux/x64), but the automated tests never
  exercise the real ONNX path, so *synthesis itself* is untested outside the author's
  machines rather than known working. First use downloads the
  `onnx-community/Kokoro-82M-v1.0-ONNX` weights into `data/models/`; expect a large
  one-time download before the first sentence plays.
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

`pnpm test` runs all three packages (about 471 tests).

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
decision log records what was rejected, and 90 of the commits carry
`Co-Authored-By: Claude` trailers. If you are interested in what that workflow actually
looks like over a few hundred commits rather than in a demo, `docs/` is the more
interesting half of this repository.

## License

MIT — see [LICENSE](LICENSE).
