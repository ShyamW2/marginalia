#!/usr/bin/env bash
# Terminal 1 — build Marginalia and serve it on loopback, kept awake.
# Run this first; scripts/expose-tailnet.sh (Terminal 2) depends on this
# process already listening on the port below.

set -euo pipefail
# -e: stop on the first failing command (a broken build should not silently
#     fall through to serving stale/missing dist files).
# -u: treat unset variables as errors, instead of expanding to "".
# -o pipefail: a failure anywhere in a pipeline fails the whole pipeline,
#     not just its last stage.

cd "$(dirname "$0")/.."
# Move to the project root (projects/marginalia) regardless of where this
# script is invoked from. $0 is this script's path; dirname gives its
# directory (scripts/); ".." steps up to projects/marginalia.

PORT="${PORT:-5176}"
# The port the Node server listens on. Override by running
# `PORT=5177 ./scripts/serve-private.sh` — otherwise defaults to 5176,
# which is also what expose-tailnet.sh proxies by default.

pnpm build
# Compiles shared/server/web into their dist/ output. Required before
# `node server/dist/index.js` will have anything to run — this is the
# production build path, not `pnpm dev`.

echo "Starting Marginalia on http://127.0.0.1:${PORT} (loopback only)..."
# Loopback-only is deliberate (CLAUDE.md M6, SHIPPING.md "Private" rung):
# the API has no authentication, so it must never bind beyond 127.0.0.1.
# Tailnet access is layered on top by expose-tailnet.sh, not by widening
# this bind address.

NODE_ENV=production PORT="$PORT" caffeinate -is node server/dist/index.js
# NODE_ENV=production: serves the built static SPA instead of proxying to
#   a Vite dev server, and disables dev-only middleware.
# PORT="$PORT": tells the server which port to listen on (server/src/index.ts
#   reads this from the environment).
# caffeinate -is: prevents macOS from idle- or display-sleeping while this
#   process runs, so the server stays reachable overnight from the iPad.
#   (-i: prevent idle sleep, -s: prevent sleep on AC power.)
# node server/dist/index.js: runs the production build directly, no pnpm
#   wrapper in the way of caffeinate's process tracking.
