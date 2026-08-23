#!/usr/bin/env bash
# Tears down both halves of the Private rung: the tailnet proxy
# (expose-tailnet.sh) and the Node server (serve-private.sh). Safe to run
# even if one or both aren't actually up — each step just reports nothing
# to do rather than erroring.

set -uo pipefail
# Deliberately no -e here: we want to keep going and attempt every
# teardown step even if an earlier one finds nothing to stop (e.g. the
# tailnet proxy is off but the server is still running).

PORT="${PORT:-5176}"
# Must match the port used by serve-private.sh / expose-tailnet.sh.

if command -v tailscale >/dev/null 2>&1; then
  TAILSCALE=tailscale
else
  TAILSCALE=/Applications/Tailscale.app/Contents/MacOS/Tailscale
fi
# Same PATH fallback as expose-tailnet.sh, for the Mac App Store build.

echo "Turning off the tailnet proxy on port 80..."
"$TAILSCALE" serve --http=80 off
# Removes the http://<hostname>/ -> 127.0.0.1:$PORT mapping. The tailnet
# hostname stops serving the app immediately; other tailnet devices lose
# access, but the Mac itself is unaffected (loopback still works below
# until we also kill the server).

echo "Looking for a Marginalia server listening on port ${PORT}..."
PIDS=$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)
# -t: print bare PIDs only (no header/columns), so $PIDS is directly usable.
# -iTCP:$PORT -sTCP:LISTEN: only processes with a listening TCP socket on
#   this port, so we don't accidentally match unrelated connections.
# `|| true`: lsof exits non-zero when it finds nothing; with -u active
#   (but not -e), that alone wouldn't kill the script, but this keeps the
#   intent explicit and keeps PIDS as an empty string rather than aborting.

if [ -z "$PIDS" ]; then
  echo "No process is listening on port ${PORT} — nothing to stop."
else
  echo "Stopping server process(es): ${PIDS}"
  kill $PIDS
  # Sends SIGTERM (graceful shutdown request), not SIGKILL — gives the
  # Node process a chance to close its SQLite connection and any open
  # file handles cleanly instead of yanking them.

  sleep 1
  # Brief pause so the process has a moment to actually exit before we
  # check on it below.

  STILL_UP=$(lsof -tiTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$STILL_UP" ]; then
    echo "Still running after SIGTERM, forcing: ${STILL_UP}"
    kill -9 $STILL_UP
    # Only escalates to SIGKILL for whatever ignored the polite request —
    # not the default, because it can't leave the SQLite WAL file mid-write.
  fi
fi

echo "Done. Loopback and tailnet access are both closed."
