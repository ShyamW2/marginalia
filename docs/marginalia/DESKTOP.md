# Desktop — Marginalia as an installable Mac/Linux app

*The Desktop rung of `docs/SHIPPING.md`, specified. That document ranks the rung's costs
and stops; this one is the arc that takes it, and it is **binding for M44–M48**.*

**Status: scheduled after the PDF arc (M39–M43).** Decided 2026-09-09 with the operator;
see `docs/decisions.md` for the entry and for what was rejected. Windows is explicitly out
of this arc — named in §8, not built.

CLAUDE.md settled decision 4 ("wrap in Tauri/Electron only after the product is proven")
is the decision this arc executes. It is not overturned by anything here.

---

## 1. What is being shipped, decided

| Question | Ruling |
|---|---|
| Shell | **Electron.** Re-confirmed 2026-09-09 against the current native surface — see §7.1. |
| Targets | **macOS arm64, macOS x64, Linux x64.** Windows out (§8). |
| Linux format | **AppImage**, single target. No `.deb`, no Flatpak (§7.3). |
| Audio | **Ships. ONNX runtime bundled; Kokoro weights still fetched on first use** into the per-user data directory, exactly as today. Not an optional download, not cut. |
| Sequencing | **After M43.** M39–M43 are still adding to the native surface; packaging a moving target means doing M47 twice. |
| Update path | `electron-updater` against GitHub Releases. |

**The product does not change.** Nothing in M44–M48 adds a reader feature, and no task here
is allowed to. If a change to reading behaviour looks necessary to package the app, it is a
misdiagnosis — say so in NOTES.md rather than shipping it.

---

## 2. The ground truth (measured 2026-09-09, not asserted)

`docs/SHIPPING.md`'s Desktop section was written on 2026-07-30 and two of its load-bearing
facts have since expired. Both are corrected there; recorded here because the arc is
planned on the corrected numbers.

### 2.1 The native surface is five modules, not one

SHIPPING.md says *"the server is Node with `better-sqlite3` and `adm-zip`"*. Today:

| Module | On disk, all platforms | Per target | Kind |
|---|---|---|---|
| `onnxruntime-node` | **208 MB** | 31 MB (darwin/arm64) · 43 MB (linux/x64) | prebuilt, **N-API v3** |
| `@huggingface/transformers` | 48 MB | 48 MB | JS; pulls `sharp` |
| `pdfjs-dist` | 35 MB | 35 MB before pruning | JS |
| `wordnet-db` | 34 MB | 34 MB | pure data |
| `@napi-rs/canvas` | 33 MB | ~11 MB | prebuilt, **N-API** |
| `better-sqlite3` | 13 MB | ~2 MB built | **compiled from source** |

`onnxruntime-node` ships every platform in one package (`bin/napi-v3/{darwin,linux,win32}/
{x64,arm64}`); pruning the foreign ones is the single largest size win available and is an
M47 task.

⚠️ **ABI is not uniform across those, and only one of them is dangerous.** N-API is
ABI-stable, so `onnxruntime-node` (its directory is literally named `napi-v3`) and
`@napi-rs/canvas` cross into Electron's runtime unchanged. **`better-sqlite3` does not** and
needs an Electron-ABI rebuild per target. That is the same module whose build has already
been silently skipped once on this project (`pnpm-workspace.yaml`'s `onlyBuiltDependencies`
comment records the incident and why the list must live in exactly one file), and it fails
*lazily* — `import("better-sqlite3")` resolves fine and only `new Database()` throws. Any
M47 verification that stops at "the app launched" has not tested this.

### 2.2 The size estimate

SHIPPING.md's "~100MB installer" predates ONNX, pdf.js and WordNet. Realistic:
**~350 MB installed, ~150 MB per-arch DMG.** Plus an 89 MB first-run weights download that
is not in the installer and never should be.

### 2.3 What is already right, and must not be "fixed"

Verified so an implementation session does not spend M46 on work that is done:

- The job registry is bounded — `MAX_FINISHED_JOBS = 50` with an explicit prune
  (`server/src/jobs/registry.ts:49–59`).
- `inFlightRenders` (`routes/audio.ts:445`) and `authFlows` (`llm/authFlows.ts:160`) both
  delete on completion. `llm/cliPath.ts`'s cache is a handful of entries, per process.
- **All 90 API calls are relative** (`fetch("/api/…")` × 22, `` fetch(`/api/…`) `` × 68) and
  the job stream is a **fetch-stream, not an `EventSource`** (`web/src/jobs/jobsApi.ts:83`).
  So a window that loads the server's own origin needs **no networking changes at all** —
  no API base URL, no CORS, no preload bridge for data. This is the single largest thing
  that makes the port smaller than it looks; do not introduce an API base "for the desktop
  build".
- The renderer needs **no Node access**: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. The web app is an ordinary same-origin SPA and stays one.
- `server/src/startupDiagnosis.ts` already translates native-module failures into a
  readable instruction. M45 surfaces it in a dialog; it does not rewrite it.

---

## 3. The five blockers

Each is a specific, verified defect that stops a bundle from working. Nothing here is
speculative.

### 3.1 `data/` is install-relative — a migration, not a rename

`server/src/paths.ts:12` resolves `WORKSPACE_ROOT` two levels up from the compiled file, and
everything (`DATA_DIR`, `LIBRARY_DIR`, `DB_PATH`, `DIGEST_DIR`, `MODELS_DIR`, `AUDIO_DIR`)
hangs off it. Inside a signed `.app` that is read-only and immutable.

⚠️ The operator's live `data/` is ~150 MB — 89 MB models, 48 MB audio, 5.9 MB library, and
~10 MB of `.sqlite` + `-wal` + `-shm`. **Every existing install is the operator's own**, so a
botched move loses the only real library that exists. The `-wal` and `-shm` files are part
of the database, not scratch: a move that copies `marginalia.sqlite` alone and leaves a
5 MB WAL behind silently loses the most recent writes.

### 3.2 `webDist` has the same disease, and a different answer

`server/src/index.ts:79` joins `WORKSPACE_ROOT/web/dist`. It must resolve **separately** from
the data directory — app resources and user data go to different places in a bundle, and
collapsing them into one `resolveRoot()` is the mistake this bullet exists to prevent.

### 3.3 Two asar traps, one of which fails silently

- `server/src/dictionary/wordnet.ts:286` does `createRequire(...)("wordnet-db").path` and
  hands the result to `fs.open` for on-disk binary search. Inside `app.asar` that is a
  virtual path. ⚠️ **The failure is invisible**: `getDictionary()` catches and returns
  `null` by design (`wordnet.ts:283–291`), so Define quietly degrades to its digest rung and
  nobody sees an error. A packaged build can ship with the dictionary dead and pass a
  smoke test.
- `@napi-rs/canvas`'s `.node` (dynamic `import()` at `library/pdf/rasterize.ts:39,67`) cannot
  live inside asar at all.

Both need `asarUnpack` **and** the `app.asar` → `app.asar.unpacked` path rewrite. Unpacking
without rewriting resolves to a path that no longer has the file.

### 3.4 The port is hardcoded, and freeing it breaks the app's appearance

`server/src/index.ts:22` reads `PORT ?? 5175` and `:107` binds it fixed. Two copies of the
app — or the app plus the operator's own `pnpm dev` — collide.

⚠️ **The obvious fix has a non-obvious cost.** Theme (`app/useTheme.ts`), accent
(`app/useAccent.ts`), paper tint (`app/usePaperTint.ts`) and the desk view mode
(`desk/deskViewBus.ts`) all persist in `localStorage`, which Chromium keys by **origin**.
`http://127.0.0.1:54321` and `http://127.0.0.1:54322` are different origins. **A pure
ephemeral port makes the app forget its own appearance on every launch** — a first-run
experience on every run, which no reader would forgive and which is easy to misfile as a
theme bug. The ruling is in M44; the point here is that §3.4 is two problems, not one.

### 3.5 A GUI launch is the bare-`PATH` case

`claude-agent` and `codex-cli` spawn local binaries. `spawn` searches the *server's* `PATH`,
which for a double-clicked `.app` is not the login shell's — this is the exact failure the
operator hit on macOS in M26 (TASKS.md:78 already files it as *"a Desktop-rung prerequisite
found early"*). `server/src/llm/cliPath.ts` solved it for the dev server via override env
var → `PATH` + installer table → login shell. **The resolver is written; M45 is where it is
proven against a real bundle**, which is the case it was designed for and has never been
run in.

---

## 4. Memory: the process that stops restarting

The browser has been cleaning up after this app for its whole life. A reload drops every
GPU texture, every cache, every leaked listener. **An Electron window that stays open for a
week never reloads**, and the server behind it never restarts.

This is not a call for caches everywhere. Three specific things change behaviour, and
§2.3 lists what is already bounded so the effort goes to the right place.

**First, the framing, because "Electron is a RAM killer" misplaces the cost.** Electron's
fixed overhead is 3–4 processes, on the order of 100–200MB RSS combined. Set that against
what this app runs *today*: a server measured at 214MB (NOTES.md:2127) plus a browser tab.
The marginal cost of Electron over that is modest, and arguably negative once its Chromium
replaces a browser the reader had open with forty other tabs. **The RAM killer is ONNX** —
200–400MB resident once Kokoro loads, which is already paid today and simply never released.
So §4.2 is the single largest win in this arc, and reaching for Electron flags before taking
it is optimising the wrong number.

Two Electron-side levers are worth taking, both in M46: a **`--max-old-space-size` cap on the
`utilityProcess`**, so a runaway server heap fails loudly instead of quietly swapping the
machine; and a **written memory budget** (idle / reading / listening), because "bounded" with
no number is not a target. ⚠️ **What is not worth taking:** disabling the sandbox or site
isolation to save a process. It buys ~30MB and spends the security posture that M45's
`contextIsolation: true` gets for free.

### 4.1 Three unbounded GPU texture caches — the only real LRU candidates

`web/src/scene3d/spineTexture.ts:51`, `useCoverTexture.ts:9`, `useSpinePalette.ts:14` are
module-level `Map`s keyed by book, holding `three` textures, with **no eviction anywhere**.
A 200-book shelf browsed over a week accumulates 400 GPU textures nothing frees.

⚠️ **Dropping the `Map` entry is not the fix.** `three` textures hold GPU memory that is
only released by `.dispose()`; an LRU that evicts without disposing moves the leak from JS
heap to VRAM, where it is harder to see. `useSpinePalette`'s cache is plain data and needs
bounding but not disposal — do not give all three the same treatment by reflex.

### 4.2 The Kokoro session is pinned forever

`server/src/audio/kokoro.ts:18–19` — `modelPromise` is a module-level cache with **no unload
path**, deliberately and correctly for a dev server. Play one paragraph at 09:00 and the
ONNX session plus its allocator arena are resident at midnight.

The existing invalidation is by model *path* only (a settings change). An idle unload is a
second, orthogonal reason to drop it, and must not fight the first.

### 4.3 Uploads are 200 MB into RAM

`server/src/routes/resources.ts:45–46` — `multer.memoryStorage()` with a 200 MB limit.
SHIPPING.md files this under Hosted; it is a Desktop problem too, because importing a large
scanned PDF spikes RSS by its full size **inside the process that also holds the model**.

### 4.4 The baseline that already exists

NOTES.md:2127 records **server RSS 214 MB** after a digest run (up from ~168 MB earlier) —
measured, and *before* Kokoro loads. M46 is measured against that number, not against a
feeling.

---

## 5. The milestones

Sequenced so each is verifiable alone, and so the unfamiliar, slow work (signing) happens
after the work that would invalidate it. **Per-milestone figures are implementation sessions,
and they are not the calendar — read §6 before planning against them.** What sets the clock
here is Apple enrollment and M47's CI loop, neither of which gets faster when code does.

### M44 — The relocatable server (2–3 sessions). **No Electron.**

The highest-leverage milestone in the arc and the only one that is dangerous to the
operator's data. All of it is debuggable in a plain Node process against the real `data/`,
which is where the migration should break — not inside an app bundle.

- **`resolveDataDir()`**: `MARGINALIA_DATA_DIR` → OS per-user directory
  (`~/Library/Application Support/<name>` · `$XDG_DATA_HOME`/`~/.local/share/<name>`) →
  the legacy install-relative path. `paths.ts`'s exports become derived, and every consumer
  keeps its current name so nothing else changes.
- **The migration.** One-time, on a legacy `data/` only. **Copy-then-verify-then-mark, never
  move** — the source is left intact and a marker file records success, so a failure is
  recoverable by deleting the destination. Must move the `-wal` and `-shm` alongside the
  `.sqlite` (§3.1), or check-point the WAL first and prove it.
- **`resolveResourceDir()`**, separate from the data directory, for `webDist` (§3.2).
- **`wordnet-db` path resolution** behind a helper that is asar-aware now, so M47 has
  nothing to retrofit (§3.3).
- **The port**, and the appearance problem it creates (§3.4). The ruling: **prefer 5175,
  fall back to the next free port, and move the four `localStorage` UI settings into the
  existing `settings` table.** Both halves. The stable-port preference keeps Chromium's own
  origin-keyed state (zoom, devtools) put; moving the four settings server-side is what
  makes correctness independent of which port was free — and they are settings, so the
  sidecar store is where CLAUDE.md decision 6 already says they belong. A custom `app://`
  protocol was considered and rejected (§7.2).

**Acceptance (can fail):** the built tree, copied to an arbitrary path with
`MARGINALIA_DATA_DIR` pointed at an empty directory, boots, creates the data dirs, serves
the SPA, imports *Alice* and answers a question. Separately: a **copy** of the operator's
real `data/` is migrated, and the resulting library, highlights, threads and reading
positions are compared row-count-for-row-count against the original. Separately again: the
app is launched twice on two different ports and both windows show the operator's chosen
theme and accent.

> **M44's gate is a shippable artifact.** A ~20-line launcher that starts the bundled
> server and opens the default browser gives a double-click build with no Chromium, no
> packaging and no notarization. It is **not** the deliverable — a browser tab fails the
> hand-it-to-a-friend test, and Safari does not render what this app is developed against —
> but it proves relocatable data, bundled assets and port handling in week one. Build it,
> use it, do not ship it.

### M45 — The Electron shell (2–3 sessions)

- Main process, `BrowserWindow`, single-instance lock, native menu, window-state
  persistence.
- **Express runs in a `utilityProcess`, not in main.** A `better-sqlite3` ABI fault should
  kill a child the main process can report on, not the window. `startupDiagnosis.ts`'s
  message goes into a dialog (§2.3).
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The renderer loads
  `http://127.0.0.1:<port>/` and every relative fetch resolves. No preload data bridge.
- **`cliPath.ts` proven against a bundle** (§3.5) — the login-shell fallback is now the
  common path, not the exotic one.
- The two local providers degrade to a legible "not installed", never an error
  (SHIPPING.md's Desktop bullet).
- **Detect software rendering and feed the gate that already exists** (§7.1b). Chromium
  falls back to SwiftShader on a machine with a missing or blacklisted GPU driver and says
  nothing; the shelf and the fold then run at a few frames per second with no error.
  `app.getGPUFeatureStatus()` in main answers it; the answer joins `reducedMotion` and
  `contextLost` in `Scene3D.tsx:192`'s `canRender`, rather than becoming a fourth
  independent path. This is decision 14's required degraded path getting its missing
  trigger — not a new fallback.

**Acceptance (can fail):** opens the reader, imports an EPUB, highlights, asks a question
against a pasted API key, publishes to a vault folder, and **survives a quit-and-relaunch**
with library and highlights intact. On a Mac where `codex` is installed via `nvm`, the
Accounts row reports it found — launched from Finder, not from a terminal. And: launched
with `--disable-gpu` (standing in for a driverless Linux box), the app falls back to the
2D/list surfaces rather than rendering the shelf in software — the same state
`prefers-reduced-motion` already produces, reached by a different trigger.

### M46 — The long-lived process (2 sessions + a 12h soak)

- **LRU the three texture caches** (§4.1), bounded by count, `.dispose()` on evict for the
  two that hold `three` textures.
- **Idle unload for the Kokoro session** (§4.2), orthogonal to the existing model-path
  invalidation.
- **`multer` → `diskStorage`** into a temp dir under the data directory, with cleanup on
  both success and failure (§4.3).
- **A written memory budget** — idle, reading, listening — recorded in NOTES.md before the
  work starts, so the other tasks have a target rather than a direction. Anchored on
  NOTES.md:2127's measured 214MB plus a measured Electron baseline, not on a guess.
- **`--max-old-space-size` on the `utilityProcess`**, set from that budget. The point is a
  loud failure instead of a silent swap, so the cap must be *tested* by exceeding it.
- **A soak.** Window open on a book overnight; RSS and GPU memory sampled at start, +1h and
  +12h.

**Acceptance (can fail):** before/after numbers, written into NOTES.md, against NOTES.md's
existing 214 MB baseline. Specifically: opening 50 books in the shelf and returning to the
Desk leaves GPU texture count bounded (it is currently unbounded — prove the change by
measuring both); a 12-hour idle soak after one audio playback shows RSS returned to within
a stated margin of its pre-playback value; a 150 MB PDF import does not spike RSS by 150 MB.
Same discipline as M27's fold measurements — numbers, not "feels fine".

### M47 — Packaging and the native matrix (3–5 sessions; the arc's bottleneck)

- `electron-builder`. Targets: `dmg` (arm64, x64), `AppImage` (x64).
- **Prune `onnxruntime-node`'s foreign platforms** — 208 MB → 31–43 MB per target (§2.1).
- **`asarUnpack` + the `app.asar.unpacked` rewrite** for `@napi-rs/canvas` and `wordnet-db`
  (§3.3).
- **Electron-ABI rebuild for `better-sqlite3`** per target; the N-API modules cross
  unchanged (§2.1).
- **Exclude `sharp`, then re-run the license audit.** `sharp` has **zero direct imports** in
  this codebase — it is an optional peer of `@huggingface/transformers`, and Kokoro is
  audio-only. SHIPPING.md step 2 warns that LGPL-3.0 `@img/sharp-libvips-*` "stops being
  inert at Desktop" because a bundle redistributes the binary. If it can be excluded, the
  relinking obligation never attaches. ⚠️ This is a *check*, not an assumption: confirm
  `transformers` does not lazily `require` it on the Kokoro path before declaring victory,
  and if it does, the LGPL obligation is real and gets its own decisions.md entry.
- GitHub Actions matrix — macOS arm64, macOS x64, Linux x64. This is CI work, not laptop
  work; a `better-sqlite3` built on the operator's Linux box is not a macOS artifact.

**Acceptance (can fail):** an installer produced **by CI, not by the operator's laptop**
runs on a machine with no Node, no pnpm and no Claude CLI. Inside it: an EPUB imports (proves
`better-sqlite3` actually bound — §2.1's lazy-failure warning), a PDF page rasterizes (proves
`@napi-rs/canvas` unpacked), **Define returns a real WordNet definition** (proves the
dictionary is alive rather than silently `null` — §3.3), and audio plays one paragraph
(proves ONNX survived pruning).

### M48 — Signing, notarization, keys and updates (2–3 sessions; gated on enrollment)

⚠️ **Apple Developer Program enrollment starts on day zero of M44, not here.** Individual
identity verification is days-to-weeks of *calendar* and blocks nothing before this
milestone. ~$99/yr.

- Developer ID Application certificate; hardened runtime; `notarytool submit --wait`;
  staple.
- **Entitlements.** Electron needs `com.apple.security.cs.allow-jit` and
  `allow-unsigned-executable-memory` for V8. Spawning `claude`/`codex` may additionally need
  `allow-dyld-environment-variables` and/or `disable-library-validation` — this is the
  entitlement most likely to surprise, and it interacts with §3.5. Find out by testing a
  notarized build, not by reading a table.
- Cert `.p12` + password + App Store Connect API key into CI secrets.
- **Keys move to the OS keychain.** `provider_profiles.anthropic_api_key` /
  `openai_api_key` are plaintext (`migrations.ts:330,334`). Defensible on the operator's own
  disk; not defensible in software handed to someone else. `safeStorage` behind the existing
  settings seam, with a migration for existing rows and a fallback when the platform
  keychain is unavailable (a headless Linux AppImage has no keyring).
- `electron-updater` against GitHub Releases. Without it, a bugfix means asking everyone to
  re-download.
- **A real name and icon.** SHIPPING.md makes the Desktop rung the deadline for the name,
  and notes "Marginalia" is taken by at least one reading-adjacent project. This is the last
  milestone at which it is free to change (§8).

**Acceptance (can fail):** `spctl -a -vvv` passes on a Mac that has never seen the source,
against a DMG **downloaded from a GitHub Release** — verified by downloading and
double-clicking, not by reading the build log. A subsequent release is picked up by
`electron-updater` and applied. An existing profile's API key is readable after the keychain
migration and is **no longer present in plaintext in the database** — checked by reading the
row.

Then SHIPPING.md rule 2: **a rung is not reached until someone who is not the operator has
used it.** Clean machine, downloaded installer, imports an EPUB, answers a question,
publishes to a vault, survives a restart. Until that happens the arc is built, not shipped.

---

## 6. Cost and calendar

⚠️ **Corrected 2026-09-09, same day, after the operator pushed back.** The first version of
this section said "~4–6 weeks of implementation sessions", which was solo-human-developer
weeks written into a doc for a project that ships an M30-sized milestone in 3–4 agentic
sessions. The correction is not "divide by ten", because **this arc's composition differs
from every milestone before it.** M30 was code end to end — exactly the thing that
compresses. M44–M48 is three kinds of work:

1. **Code — compresses fully.** `resolveDataDir`, the LRU caches, `multer`→disk,
   `safeStorage`, the Electron scaffolding. About two-thirds of the task list, at normal
   velocity.
2. **Machine wall-clock — compresses not at all.** A CI matrix build is 10–20 minutes, and
   packaging defects are only discoverable by *running the produced artifact*, so M47 is a
   build → download → run → fix loop. Each `notarytool submit --wait` is 5–30 minutes.
   M46's 12-hour soak is 12 hours.
3. **A second machine and a person.** M48's clean-Mac Gatekeeper test, and SHIPPING.md
   rule 2's "someone who is not the operator has used it."

| Milestone | Sessions | What actually sets the clock |
|---|---|---|
| M44 | 2–3 | The operator's review of the migration, not agent time |
| M45 | 2–3 | Well-trodden; fast |
| M46 | 2 | **+12h soak**, uncompressible |
| M47 | 3–5 | **10–25 CI iterations.** The bottleneck of the arc |
| M48 | 2–3 | Notarization round trips; **gated on Apple enrollment** |

- **Effort: ~10–15 implementation sessions** across M44–M48 — on the order of a week of
  evenings.
- **Calendar: ~2–4 weeks**, set almost entirely by Apple enrollment and M47's CI loop, not
  by how fast code is written. ⚠️ **The arc cannot finish faster than enrollment.** That
  makes starting it the highest-leverage schedule action available, and it is free to start
  months early — hence its placement at the top of M44 rather than in M48 where it is
  needed.
- **Money: ~$99/yr** (Apple). Linux has no signing authority to satisfy; AppImage is free.
  No per-user and no per-month cost — this rung stays free to run, which is most of its
  appeal against Hosted.
- **The real cost is support.** SHIPPING.md says it and it is worth restating: past M48 the
  operator is the person who fixes it when it breaks on someone else's OS.

---

## 7. Considered and rejected

### 7.1 Tauri — rejected, more firmly than in 2026-07 (and it does not buy an iPad)

SHIPPING.md already recommended Electron on the strength of one native module. The current
surface (§2.1) is five, one of which is 208 MB of prebuilt ONNX. Tauri would need Node as a
sidecar binary plus that entire `node_modules` tree, so it **wins nothing on size** and
loses Electron's tooling for rebuilds, notarization and updates. The alternative — porting
~19k lines of server to Rust — is a rewrite, not a packaging step. The ruling stands and is
now better supported than when it was made.

⚠️ **"But Tauri 2 has iOS/Android targets" is true and does not apply.** Tauri mobile expects
a **Rust backend compiled into the binary**; iOS forbids shipping a Node runtime that spawns
child processes, and forbids JIT outside the system webview. This server is Node with five
N-API modules that shells out to `claude` and `codex` — none of it crosses onto an iPad under
Tauri or anything else, so "Tauri for iPad" *is* the Rust rewrite, at the price above.
**Choosing Electron therefore costs nothing on iPad**, because no packaging choice buys one.
SHIPPING.md's existing ruling stands unchanged: an iPad is reached by the **Private** rung
(server on one box, browser on the iPad), or later by a native client against the same HTTP
API — a second front end, not a packaging step. Desktop and Private remain siblings; taking
Desktop first is a choice about audience, not a prerequisite.

### 7.1b Direct Metal / a native graphics path — rejected; and WebGPU with it

Chromium on modern macOS already runs WebGL through **ANGLE on Metal** by default. The R3F
canvas (`scene3d/Scene3D.tsx:298–301`) is on the GPU in a browser today and is on the GPU in
Electron through the same path — **there is no acceleration to switch on, and no SDK step.**
Going direct would mean dropping WebGL, i.e. rewriting M23's substrate *and* M27's fold
renderer, against settled decision 14's "one 3D substrate, behind one seam", for scenes that
are a row of book spines and one curling sheet. `three`'s `WebGPURenderer` is declined for
the same reason plus a second: it would be a second renderer path on a seam whose whole
purpose is that there is one.

⚠️ **The real graphics risk is on Linux, and it is the inverse of the question.**
`Scene3D.tsx` already handles reduced motion (`:76`) and context loss (`:234–235`) and gates
rendering on both (`:192`, `canRender`). It cannot detect **WebGL running on SwiftShader** —
Chromium's software fallback. An AppImage on a machine with a missing or blacklisted GPU
driver renders the shelf and the fold *in software*, at a few frames per second, **with no
error anywhere**. Decision 14 requires every 3D surface to own a deliberate degraded path;
that path exists, and this is its missing trigger. M45 adds it.

### 7.2 A custom `app://` protocol for a stable origin — rejected

It would solve §3.4's `localStorage` problem directly. But every one of the 90 relative
`/api` fetches would then resolve to `app://…/api` and need a protocol handler proxying to
the loopback server, including the streaming job endpoints (`routes/jobs.ts:20,73`).
Streaming through `protocol.handle` is the fiddliest part of Electron's surface, and the
alternative in M44 — stable-port preference plus four settings moved to the sidecar store —
is smaller, more testable, and makes the app's appearance correct for reasons that have
nothing to do with Electron.

### 7.3 `.deb` and Flatpak — rejected for this arc

`.deb` reaches only Debian/Ubuntu and needs a second target to match AppImage's coverage.
**Flatpak is rejected on a product ground, not a packaging one:** its sandbox is a direct
conflict with the vault, which writes to an arbitrary operator-typed path
(`vault/writeVaultFile.ts`). That is the same conflict SHIPPING.md records for the Mac App
Store under Stores, arriving early and for no benefit. Revisit only alongside the
security-scoped-bookmark work that rung would need anyway.

### 7.4 Cutting audio from v1 — offered and declined

Dropping `onnxruntime-node`, `@huggingface/transformers` and `sharp` would remove ~90 MB per
target, the LGPL question, and the largest resident allocation — and SHIPPING.md step 9
notes the TTS stack has never run on a machine that is not the operator's, making it the
least-proven thing to hand to a stranger. **The operator declined**: the product ships whole.
The consequences are M46's idle-unload task and M47's pruning task, both of which exist
because of this ruling.

---

## 8. Deliberately left open

- **Windows.** Named in the operator's ask as "explore later" and not built here. The
  incremental work is a fourth CI target plus an OV code-signing certificate on a hardware
  token or cloud HSM (~$200–400/yr; the token requirement is no longer optional). Nothing
  in M44–M47 should make it harder, and `win32` pruning in M47 must be a target list rather
  than a deletion.
- **The name.** SHIPPING.md makes Desktop its deadline. M48 is where it becomes expensive to
  change — after that it is in an installer, a bundle id, a keychain entry and an update
  feed.
- **Whether Private is still wanted afterwards.** Desktop and Private are siblings, not
  steps (SHIPPING.md). Taking Desktop does not settle Private, and Private is still the only
  rung that reaches an iPad.
- **`app.getPath('userData')` vs. an XDG path on Linux.** M44 picks one; the AppImage
  question (`$XDG_DATA_HOME` vs. Electron's default) is a detail for that milestone, not a
  decision needing a doc.
