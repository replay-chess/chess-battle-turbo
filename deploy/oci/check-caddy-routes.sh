#!/usr/bin/env bash
# The one Caddyfile serves the dev box (compose profile `worker`) and production (no worker). Runs Caddy from that file
# in Docker, once per profile, and checks the internal routes (regression: caddy-worker-route-on-prod, FIX-2):
#   unsigned /internal/*                          401 on both (the HMAC pre-check)
#   signed /internal/metrics, /internal/analysis/* 404 without the worker profile, proxied (502 here, no upstream) with it
#   signed /internal/load                          404 on both (docker network only)
# Usage: deploy/oci/check-caddy-routes.sh   (needs docker)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NAME="caddy-routes-check-$$"
PORT="${CADDY_CHECK_PORT:-18089}"
fail=0
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
expect() {
  local label="$1" want="$2" got="$3"
  if [ "$got" = "$want" ]; then echo "ok   $label → $got"; else echo "FAIL $label → $got (want $want)"; fail=1; fi
}
for profile in "" worker; do
  cleanup
  docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" -e WS_HOST=:8080 -e COMPOSE_PROFILES="$profile" \
    -v "$DIR/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.25; done
  base="http://127.0.0.1:$PORT"
  worker_code=$([ "$profile" = worker ] && echo 502 || echo 404)
  p="${profile:-none}"
  expect "[$p] unsigned /internal/metrics" 401 "$(code "$base/internal/metrics")"
  expect "[$p] signed /internal/metrics" "$worker_code" "$(code -H 'X-Rc-Sig: x' "$base/internal/metrics")"
  expect "[$p] signed /internal/analysis/kick" "$worker_code" "$(code -X POST -H 'X-Rc-Sig: x' "$base/internal/analysis/kick")"
  expect "[$p] signed /internal/load" 404 "$(code -H 'X-Rc-Sig: x' "$base/internal/load")"
done
exit "$fail"
