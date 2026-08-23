#!/usr/bin/env bash
# Terminal 2 — expose the already-running Marginalia server (from
# serve-private.sh) to your tailnet only. Run serve-private.sh first;
# this script does not start the app itself, only the tailnet proxy.

set -euo pipefail
# Same reasoning as serve-private.sh: fail loudly on the first error
# rather than printing a misleading "Serve started" over a broken proxy.

PORT="${PORT:-5176}"
# Must match the port serve-private.sh actually bound. If you overrode
# PORT there, override it here the same way.

# The Tailscale CLI isn't on $PATH when Tailscale was installed from the
# Mac App Store (that build is sandboxed). Prefer a real `tailscale` on
# PATH if one exists (e.g. the standalone tailscale.com installer), and
# fall back to the App Store app's binary directly.
if command -v tailscale >/dev/null 2>&1; then
  TAILSCALE=tailscale
else
  TAILSCALE=/Applications/Tailscale.app/Contents/MacOS/Tailscale
fi

echo "Using tailscale binary: ${TAILSCALE}"
# Confirms which binary is about to run, so a PATH surprise is visible
# immediately rather than discovered later.

sudo "$TAILSCALE" set --operator="$USER"
# Lets your normal user run `tailscale serve` afterwards without sudo.
# Only needs to succeed once ever per machine, but is safe to re-run —
# it's idempotent, not something we're re-authorizing each time.

"$TAILSCALE" serve --bg --http=80 "$PORT"
# --bg: run the proxy in the background instead of blocking this terminal.
# --http=80: serve plain HTTP on port 80 of your tailnet hostname (no TLS
#   cert needed — traffic never leaves the encrypted tailnet, so this is
#   not the same risk as plain HTTP on the public internet).
# "$PORT": the local port to proxy to, i.e. where serve-private.sh is
#   actually listening (127.0.0.1:5176 by default).

"$TAILSCALE" serve status
# Prints the current proxy mapping so you can confirm it's live and see
# the exact hostname to use.

HOSTNAME=$("$TAILSCALE" status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))" 2>/dev/null || true)
# Pulls this Mac's tailnet DNS name out of `tailscale status --json`, so
# you don't have to eyeball it out of the block above. Best-effort: if
# python3 or the JSON shape isn't available, HOSTNAME stays empty and we
# just skip the friendly reminder below rather than failing the script.

echo ""
echo "On the iPad (same Tailscale account), open in Safari:"
if [ -n "$HOSTNAME" ]; then
  echo "  http://${HOSTNAME}/"
else
  echo "  the http://<hostname>.ts.net/ URL printed by 'serve status' above"
fi
# IMPORTANT: use the .ts.net hostname, not the tailnet IP (e.g.
# 100.x.x.x). On this setup, `tailscale serve` matches incoming requests
# by Host header against the configured hostname — the bare IP 404s even
# though the hostname works, because Tailscale never registered the IP
# form as a servable host. Verified 2026-08-23: hostname -> 200, IP -> 404.
