# Shipping a project from this repo

*How a `projects/<name>/` tool gets from "runs on my laptop" to something other people
can use — the rungs, what each one actually costs, and the gate that stops each one.
Repo-level on purpose: the ladder is the same for every project here. Marginalia is the
worked example because it is the only project that has gone far enough to have real
gates.*

**Status: none of this is scheduled.** This document settles the *shape* so that when a
rung is chosen it is chosen deliberately, and so nobody starts rung 3 by accident while
thinking they are finishing rung 1. CLAUDE.md settled decision 4 ("wrap in Tauri/Electron
only after the product is proven") stands; this document is what "wrap" turns out to
mean.

## The one-paragraph version

The rungs are not a single ladder — they fork. **Rungs 0–2 keep the product you have.**
Rung 3 (public hosted website) does not: it deletes the two things Marginalia is built
on — the local Obsidian vault and the local machine's own model access — and replaces the
copyright exposure of "my books on my disk" with "strangers' books on my server". The
useful move that gets mistaken for rung 3 is **rung 2.5, the private deployment**: the
same single-tenant app, reachable from your other devices over a private network. That
is also the gate on iPad drawing (decisions.md 2026-07-27, "Future arcs"), so it buys two
things at once.

## The ladder

| Rung | What it is | Who runs the server | Real gate |
|---|---|---|---|
| 0 | localhost, dev mode | you, `pnpm dev` | — (here today) |
| 1 | the GitHub repo | whoever clones it | license + reproducible install, not code |
| 2 | a desktop app | the app, on their machine | data location, packaging the native module, updates |
| 2.5 | a private deployment | you, on one box | authentication — there is none today |
| 3 | a public hosted website | you, for strangers | multi-tenancy, the vault's disappearance, other people's books |
| 4 | app stores / iPad / sync | ditto, plus a store | sandboxing vs. the vault; a sync design that does not exist |

---

## Rung 0 — localhost (where we are)

Verified state as of 2026-07-30, because everything below depends on it being stated
accurately:

- Node + Express 5 server on `127.0.0.1:5175` (`server/src/index.ts:89`), React/Vite
  browser client, ~24k lines of TS/TSX across `shared`/`server`/`web`.
- **No authentication anywhere.** No CORS middleware either — the app works because
  everything is same-origin behind Vite's dev proxy or the production static mount.
- **No concept of a user.** `user_id` appears zero times in the schema
  (`server/src/migrations.ts`). Settings, provider profiles, the library, reading state
  and the notepad are all global singletons.
- Data lives at `<workspace>/data` — **install-relative**, not per-user
  (`server/src/paths.ts:11–18`).
- Provider API keys are stored **in plaintext** in the `provider_profiles` table
  (`server/src/migrations.ts:319–323`).
- Two of the providers are *machine-local by construction*: `claude-agent` runs on the
  machine's own Claude Code login and deliberately scrubs `ANTHROPIC_API_KEY` to force
  subscription auth (`server/src/llm/claudeAgent.ts:110–113`); `codex-cli` (decided
  2026-07-30, CLAUDE.md decision 2 — not yet in `server/src/llm/provider.ts`) shells out
  to a locally installed binary.
- Publish writes into an operator-chosen filesystem path, guarded against escaping it
  (`server/src/vault/writeVaultFile.ts:15`). The Obsidian vault is a **local directory**,
  full stop.
- Native dependency: `better-sqlite3`, with `onlyBuiltDependencies` in
  `pnpm-workspace.yaml` because pnpm 10 silently skips its build otherwise.

Four of those bullets are the whole story of this document: **no identity, install-relative
data, local-only vault, machine-local providers.**

---

## Rung 1 — the repo

Someone clones it and runs it themselves. This is the cheapest rung by a wide margin and
the only one that costs nothing per month.

**The gate is not code.** It is that the repo has no `LICENSE`, no `README.md`, and no
install path that has ever been executed on a machine that is not yours. The two-machine
setup (Mac on Node 20/pnpm 9, Linux on Node 24/pnpm 10) has already produced silent
`better-sqlite3` ABI crashes — a stranger on a third Node major is the same failure with
nobody to diagnose it.

Logistics, in order:

1. **Choose a license. — DONE 2026-08-06: MIT.** No license means "all rights reserved" —
   nobody may legally use it, which is a decision made by default rather than on purpose.
   MIT if the goal is a portfolio piece people can learn from; AGPL if you want to stop
   someone hosting it as a product without sharing changes; "source-available, no license"
   only if you genuinely want look-don't-touch. **MIT was chosen** — the realistic risk
   here is obscurity, not exploitation. `LICENSE` is at the repo root.
2. **Audit third-party licenses before publishing. — DONE 2026-08-06, nothing blocks MIT.**
   Generated with `pnpm licenses list --json`, not asserted from memory: 326 MIT, 30 ISC,
   18 BSD-3-Clause, 17 Apache-2.0, 7 BSD-2-Clause, plus singletons. The only copyleft is
   **LGPL-3.0-or-later in `@img/sharp-libvips-*`** — transitive (under
   `@huggingface/transformers`), unmodified, and not redistributed by a source repo, so it
   is inert at rung 1. ⚠️ **It stops being inert at rung 2**, where an Electron bundle
   *does* redistribute the binary and LGPL's relinking obligation attaches. Re-run the
   audit there rather than trusting this line.
3. ⚠️ **Fixtures: the check was run on 2026-08-06 and *failed*.** `metamorphosis.epub` was
   the David Wyllie translation from Project Gutenberg #5200, whose own metadata reads
   `<dc:rights>Copyrighted. Read the copyright notice inside this book for details.</dc:rights>`
   and whose front matter says `*** This is a COPYRIGHTED Project Gutenberg eBook. ***`.
   PG hosts it by the translator's permission; that permission does not extend to us.
   **Metamorphosis is a dead end in every direction** — Wyllie is permission-only, the
   Muir translation is in copyright until 1 January 2029 (Standard Ebooks lists it as
   pending for exactly that reason), and Ian Johnston's is non-commercial-use-only.
   **Replaced with `jekyll-and-hyde.epub`** (PG #43, Stevenson 1886, no translator,
   `<dc:rights>Public domain in the USA.</dc:rights>`) — same provenance as the Alice
   fixture. The swap is a code change, not a file move: `epub.test.ts` asserts real
   parsed values, and its cover test structurally requires *two distinct books*.
   The replacement was chosen partly because its NCX has the same 13-navPoints/12-hrefs
   fragment collision the chapter-title test exists to prove; a fixture without one
   would have silently gutted that test.
   ⚠️ **Deleting the file is not sufficient.** The blob has been in history since M0
   (`f4e7b9d`, 2026-07-13), so a public repo would still serve it via `git log`. The
   purge must happen in the same history rewrite as step 5.
4. **Secrets history: re-verified clean 2026-08-06** at `99bba6c`, 126 commits (was
   2026-07-30 at 80 commits). No `.env`, `.sqlite`, `.db`, `.pem`, `.key` or credential
   file has ever been added; a full `git log -p` scan for live key shapes
   (`sk-ant-api`, `sk-proj-`, `ghp_`, `AKIA…`, PEM blocks) returns nothing; the only
   key-shaped strings remain `sk-ant-test` placeholders in `providers.test.ts`. No
   personal emails or home-directory paths in tracked files. `.gitignore` covers
   `projects/marginalia/data/` and `.env*`. **Re-run this check immediately before making
   the repo public** — it is cheap and the failure is unrecoverable.
5. **Commit identity — and the rewrite window closes at first push.** All 126 commits are
   authored `shyamwijayakumaran@MacBook-Air.local`. The exposure is mild (an mDNS
   hostname is not routable and not a credential), but the *attribution* cost is not:
   GitHub matches commits to accounts by email, so none of the 126 would attribute to
   the account, carry an avatar, or land on the contribution graph. Rewrite to
   `212300859+ShyamW2@users.noreply.github.com`, which attributes without publishing a
   real address. Verified on a throwaway clone 2026-08-06: an `--env-filter` rewrite
   changes the email and every SHA, and changes **nothing else** — all 126 author *and*
   committer dates identical, HEAD's tree hash identical (`baa043d…`), all 83
   `Co-Authored-By: Claude` trailers intact. Do it **before the first push**: GitHub keeps
   force-pushed objects reachable forever. Fold step 3's blob purge into the same pass.
6. **A README that is a runbook, not a pitch.** Node major, pnpm version, the
   `onlyBuiltDependencies` trap, `pnpm dev`, where `data/` appears, how to point it at a
   provider, and how to import the fixture. The existing docs are written for *sessions
   working on the project*, not for a stranger running it — do not assume they transfer.
7. **Decide what the docs say about you.** `CLAUDE.md`, `docs/OPUS.md`,
   `SONNET_PROMPT.md` and `decisions.md` make the AI-assisted process completely legible,
   including the operator-feedback quotes. That is unusually honest and arguably the most
   interesting thing in the repo — but it is a *choice*, and it should be a conscious one.
   **Recommendation: publish them.** They are the differentiator. Note that the choice is
   already half-made in a place that is easy to miss: 83 of 126 commits carry
   `Co-Authored-By: Claude <model>` trailers, which GitHub renders as co-authors. Publish
   deliberately or strip them in the step 5 rewrite; do not discover them afterwards.
8. **Disclose the proprietary dependency.** `@anthropic-ai/claude-agent-sdk` ships
   `LICENSE.md` reading `© Anthropic PBC. All rights reserved.` — it is not open source,
   and it is a *required* runtime dependency of `server`. This does not constrain MIT on
   our own code, but a stranger running `pnpm install` acquires a proprietary package and
   is entitled to know before they do. Say so in the README rather than in a footnote.
9. **State what is unverified rather than implying it works.** Three subsystems have
   never run on a machine that is not the operator's: the `claude-agent` provider (needs
   a local Claude Code login), `codex-cli` (shells out to a local binary), and the TTS
   stack. A cold `pnpm install` prints `Ignored build scripts: … onnxruntime-node …
   sharp` because `onlyBuiltDependencies` lists only `better-sqlite3` and `esbuild`, and
   the audio tests pass without those natives because they never touch the real ONNX
   path — so "audio works elsewhere" is *unproven*, not proven. Kokoro also downloads
   model weights into `data/models` on first use, an undocumented first-run network and
   disk cost. The README describes these as untested-elsewhere until someone tests them.
10. **The suite must be green at the moment of publication.** On 2026-08-06 `pnpm test`
   was **red on main** — two stale assertions in `shared/src/schemas.test.ts` left behind
   by M21 and M22.5 — and had been for some time, because `pnpm -r test` bailed on the
   first failing package and hid 443 downstream tests. Both are fixed (the script is now
   `pnpm -r --no-bail test`), but the lesson generalises: a red suite is the first thing
   a stranger sees, and rule 6's "re-run at the moment of publication" applies to
   `pnpm test` exactly as it does to the secrets and license checks.

**Acceptance criterion (can fail):** a person who has never seen the repo, on a machine
with a different Node major, gets from `git clone` to a rendered page of *Alice* in under
15 minutes using only `README.md` — verified by actually watching someone do it, not by
re-reading the README.

**Half of that criterion was executed on 2026-08-06** and passed: a clone into a scratch
directory on Node 24 / pnpm 10 ran `pnpm install` (with `better-sqlite3` compiling
correctly), `pnpm build`, 264 server + 179 web tests, then booted
`NODE_ENV=production node server/dist/index.js`, served the built SPA, imported
*Alice* over the API and wrote `data/library/` — in about two minutes, not fifteen.
**The other half cannot be simulated.** The machine half proves the install path; only a
real person proves the README, and no README existed when this was run. Do not read the
green result as the criterion being met.

**What rung 1 does not give you:** users. A repo is distribution to people who already
run dev tooling. If the goal is "my friend reads a book in this", skip to rung 2.

---

## Rung 2 — the desktop app

CLAUDE.md decision 4's endpoint. The product does not change; the delivery does.

**Electron vs. Tauri is decided by the native module, not by taste.** The server is Node
with `better-sqlite3` and `adm-zip`. Electron ships a Node runtime, so the server moves in
essentially as-is — the cost is a ~100MB installer and per-platform prebuilt
`better-sqlite3` binaries. Tauri ships a Rust core and a system webview (~10MB), which
means either bundling Node as a sidecar binary (most of Electron's problems, none of its
tooling) or porting the server to Rust (a rewrite of 24k lines' worth of behaviour).
**Recommendation: Electron**, and revisit only if installer size becomes a real
complaint.

⚠️ **`data/` must move first, and it is a migration, not a rename.** `paths.ts` resolves
`DATA_DIR` two levels up from the compiled file. Inside an app bundle that is a read-only
(macOS: signed and immutable) location. It has to become the OS per-user data directory
(`app.getPath('userData')` / `~/.local/share/marginalia` / `%APPDATA%`), with a one-time
move of any existing `data/` — and every existing install is *your* installs, so the
migration has to not lose the library. Treat it with the caution the data directory has
already earned.

Logistics:

- **Code signing and notarization.** macOS: Apple Developer Program (~$99/yr as of
  writing) plus notarization in CI, or every user sees "damaged and can't be opened".
  Windows: an OV code-signing certificate on a hardware token or cloud HSM (~$200–400/yr
  range; the token requirement is not optional any more), or SmartScreen warns on every
  download. Linux: AppImage/deb, no signing authority to satisfy.
- **Updates.** `electron-updater` against GitHub Releases is the cheap path and works for
  a private-ish audience. Without it, shipping a bugfix means asking everyone to
  re-download.
- **Build matrix.** macOS (arm64 + x64), Windows x64, Linux x64 — each needing its own
  `better-sqlite3` build. This is CI work (GitHub Actions runners cover all three), not
  laptop work.
- **Keys move to the OS keychain.** Plaintext keys in SQLite are defensible when the file
  is on your own disk and nobody else's; they are not defensible in software you hand to
  someone else. `safeStorage` (Electron) or `keytar` behind the existing settings seam,
  with a migration for existing rows.
- **The two local providers survive rung 2 intact** — a desktop app *is* the user's
  machine, so `claude-agent` and `codex-cli` work exactly as they do now, for users who
  happen to have those CLIs. They must degrade to a legible "not installed" state rather
  than an error, since most users will not.
- **A real name and icon.** "Marginalia (working name)" is not shippable, and the name is
  taken by at least one other reading-adjacent project — check before printing it on
  anything.

**Acceptance criterion (can fail):** on a clean machine with no Node, no pnpm and no
Claude CLI, a downloaded installer produces an app that imports an EPUB, answers a
question against a pasted API key, and publishes to a vault folder — and *survives a
restart* with library and highlights intact.

**Cost shape:** ~$100–500/yr in certificates, zero per-user, zero per-month. Support
burden is the real cost: you are now the person who fixes it when it breaks on someone
else's OS.

---

## Rung 2.5 — the private deployment (the one that is actually next)

The same single-tenant app, running on one box you control, reachable from your phone,
your iPad, or your other laptop. **This is not a smaller rung 3 — it is a different
thing**, because there is still exactly one user: you.

Why it is worth naming: it is the gate on iPad drawing (decisions.md 2026-07-27), on
reading in bed, and on "show someone the thing" — and it costs a weekend, not a product.

⚠️ **The landmine: "just bind to 0.0.0.0" is a whole-machine compromise.** The API has no
auth, and it can read the library, read and write the Obsidian vault path, and spend
model tokens. Exposing it to a LAN hands all of that to every device on the network —
and to anything that gets onto that network. M6's loopback binding was a deliberate
security decision (CLAUDE.md; decisions.md 2026-07-27) and undoing it *by itself* is not
the fix.

Two acceptable shapes, in order of preference:

1. **A private overlay network (Tailscale/WireGuard).** The server stays bound to the
   overlay interface; devices authenticate at the network layer; nothing is exposed to
   the public internet; no auth code is written. **Recommendation.**
2. **A reverse proxy with real authentication in front** (Caddy + an auth layer, or an
   SSO proxy) on a machine you own. More moving parts, more to get wrong, but works for
   people who cannot install a VPN client.

Not acceptable: port-forwarding the dev server; adding a shared password in application
code and calling it authentication.

**Acceptance criterion (can fail):** with the laptop's firewall allowing the LAN, the API
is *unreachable* from a device on the same LAN that is not on the overlay network —
verified by trying it, not by reading the config.

---

## Rung 3 — the public hosted website

This is where the product changes, and the honest framing is that **hosted Marginalia is
a different product wearing the same UI.** Three things break, and none of them are
implementation details:

**1. There is no user.** Multi-tenancy is not a feature to add; it is a rewrite of every
query in the app. Every table is a global singleton today. Adding identity means: an
auth system, a `user_id` on ~24 tables and every read path, per-user library isolation
(with a test that proves a user cannot fetch another user's `resource_id`), per-user
settings and provider profiles, session handling, account recovery, deletion on request.
Budget this as a milestone arc, not a milestone.

**2. The vault does not exist on a server.** Settled decision 6 makes the Obsidian vault
a one-way compiled projection onto a local directory — a directory the user opens in
Obsidian on their own machine. On a server there is no such directory. The hosted
options are: (a) drop publishing entirely, which removes a third of the product;
(b) compile to a zip the user downloads, which loses the "it just appears in my vault"
magic that is the point; (c) integrate with a sync provider the user already has
(Obsidian Sync, Dropbox, a GitHub repo), which is a new subsystem behind a new seam and a
new cloud dependency requiring a decisions.md entry under settled decision 10. **None of
these is free, and (b) is the only one that is small.**

**3. You would be storing other people's books.** Locally, an imported EPUB is the user's
own file on the user's own disk. Hosted, it is a copyrighted work sitting on your
server — legally, user-generated content, which brings: a DMCA designated agent
registered with the Copyright Office (a small filing fee, renewed every few years), a
takedown process, terms of service, a privacy policy, and the storage bill. The
content-addressed store makes dedup easy, which is convenient and also means one popular
pirated EPUB is stored once and served to many — do not build that accidentally.

And two more that are merely expensive:

**4. Who pays for the tokens.** BYO-key (the user pastes their own key) keeps you out of
the billing business but means storing *other people's* API keys — real key custody,
encryption at rest, an incident plan. Your-key means metering, quotas, abuse prevention
and a revenue model on day one, because a book-sized context per question is not a cheap
request. **The `claude-agent` provider must be compiled out of a hosted build, not hidden
in the UI** — it authenticates as *your* Claude subscription, and exposing it would hand
strangers your account. Same for `codex-cli`, and doubly so given it shells out.

**5. The server is not hardened for hostile input.** Uploads are 200MB into **memory**
(`multer.memoryStorage()`, `server/src/routes/resources.ts:25–27`); a handful of
concurrent uploads is an out-of-memory kill. There is no rate limiting, no request
authentication, and EPUB parsing (`adm-zip` + `htmlparser2`) runs on attacker-supplied
zip files in the same process. Every one of those is fine on loopback and none of them is
fine on the internet.

**Cost shape:** a VPS or container host, object storage that grows with every user's
library, a database that is no longer a file on disk (SQLite is fine for one user; it is
not fine for concurrent multi-tenant writes — Postgres, which is a migration of
`server/src/db.ts` and every migration in it), backups you actually restore-test, a
domain, TLS (free), an email sender for account flows, plus the model bill if it is your
key. Realistically $20–100/mo before any users, more with them, plus the recurring
attention that a public service demands whether or not anyone is using it.

**The ruling: do not treat rung 3 as a deployment of this codebase.** If the hosted
product is genuinely wanted, it should start as a *design session about a different
product* — one whose vault story, identity model and content policy are decided before
any code moves — and it should be triggered by evidence that people want it, which rungs
1, 2 and 2.5 are how you gather. Building it speculatively converts a finished local
product into an unfinished hosted one.

---

## Rung 4 — further distribution

Recorded so the shape is known, not because it is near.

- **Mac App Store.** ⚠️ Direct conflict with the vault: a sandboxed app cannot write to
  an arbitrary path string typed into Settings. It needs the user to pick the folder
  through a system picker and a security-scoped bookmark to persist access. That is a
  settings-UI and a permissions change, not a build flag. Direct distribution (rung 2,
  signed + notarized) avoids this entirely and is the recommendation.
- **iPad / iOS.** Not a packaging step. Either rung 2.5 plus a browser (works today once
  auth exists, and is how iPad drawing becomes possible) or a genuine native client
  against the server API — a second front end, with the reader's entire interaction model
  rebuilt for touch. PRODUCT.md lists mobile and multi-device as explicitly out of scope;
  that has to be overturned on purpose.
- **Sync across devices.** Nothing in the system is designed for it: the library is
  content-addressed and immutable (which helps), but annotations, reading state and
  settings all assume a single writer. Multi-writer sync is a conflict-resolution design
  problem — the honest cheap version is "one server, many clients" (rung 2.5), not
  peer-to-peer replication.
- **Browser extension / web clipper.** A genuinely small, high-value adjacent shape once
  the library accepts non-EPUB resources. Out of scope while EPUB-first (decision 3)
  holds.

---

## Rules this document sets

These apply to any project in this repo, not just Marginalia:

1. **Ship down the ladder in order, and name the rung out loud.** Work that only pays off
   at rung 3 is not allowed to be smuggled into a rung-1 or rung-2 task. If a task's
   justification is "we'll need it when we host", it is a rung-3 task and it is not
   scheduled.
2. **A rung is not reached until someone who is not the operator has used it.** A
   packaged app nobody installed is not shipped; it is built.
3. **Every rung above 2 requires a written answer to "who is the user, and what happens to
   their data when they stop being one".** No answer, no rung.
4. **Exposing the server beyond loopback requires authentication in the same change.**
   Not a follow-up task. (Extends CLAUDE.md's M6 loopback decision rather than replacing
   it.)
5. **Any cloud dependency added for distribution is a settled-decision-10 exception** —
   sync provider, auth provider, error reporting, analytics. One decisions.md entry each,
   named, with a default of off.
6. **Secrets and license checks are re-run at the moment of publication**, not when the
   plan was written. A clean audit has a shelf life of one commit.

## What is deliberately left open

- Which rung is actually wanted. This document ranks the *costs*; it does not choose.
- Whether the repo goes public at all, and under which license (rung 1, step 1) — a
  recommendation is on record (MIT, docs included), not a decision.
- The name. "Marginalia" is a working name and rung 2 is the deadline for that.
- Anything about pricing, revenue or a business — out of scope here on purpose. If rung 3
  is ever taken seriously, that is its first question, not its last.

## Where the facts live

Nothing above restates a rule that lives elsewhere. The load-bearing prior decisions are:
CLAUDE.md settled decisions 4 (native shell deferred), 6 (vault is a one-way local
projection), 10 (local-first with named exceptions); decisions.md 2026-07-27 "Future
arcs" (the iPad gate is the loopback binding); PRODUCT.md "v1 scope" (multi-device and
mobile are out). If a rung is taken, the amendment goes in those files — this document
records the ladder, not the ruling.
