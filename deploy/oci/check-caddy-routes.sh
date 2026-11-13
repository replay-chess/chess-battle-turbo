#!/usr/bin/env bash
# The one Caddyfile serves the dev box (compose profile `worker`, APP_ENV=dev), production today (no worker) and
# production once P13 gives it a worker (profile `worker`, APP_ENV=production). Runs Caddy from that file in Docker,
# once per case, and checks the internal routes (regressions: caddy-worker-route-on-prod, FIX-2; phase-04 §7.7.3):
#   unsigned /internal/*                                  401 everywhere (the HMAC pre-check)
#   signed /internal/metrics, /internal/analysis/*,
#          /internal/provider/*                           404 without the worker profile, proxied (502 here, no upstream)
#                                                          with it
#   signed /internal/dev/*                                proxied only with the worker profile AND APP_ENV=dev, else 404
#   signed /internal/load                                 404 everywhere (docker network only)
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
# profile:app_env
for c in ":production" "worker:dev" "worker:production"; do
  profile="${c%%:*}"
  app_env="${c##*:}"
  cleanup
  docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8080" -e WS_HOST=:8080 -e COMPOSE_PROFILES="$profile" -e APP_ENV="$app_env" \
    -v "$DIR/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2-alpine >/dev/null
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.25; done
  base="http://127.0.0.1:$PORT"
  worker_code=$([ "$profile" = worker ] && echo 502 || echo 404)
  dev_code=$([ "$profile" = worker ] && [ "$app_env" = dev ] && echo 502 || echo 404)
  p="${profile:-none}/$app_env"
  expect "[$p] unsigned /internal/metrics" 401 "$(code "$base/internal/metrics")"
  expect "[$p] signed /internal/metrics" "$worker_code" "$(code -H 'X-Rc-Sig: x' "$base/internal/metrics")"
  expect "[$p] signed /internal/analysis/kick" "$worker_code" "$(code -X POST -H 'X-Rc-Sig: x' "$base/internal/analysis/kick")"
  expect "[$p] unsigned /internal/provider/chesscom/lookup" 401 "$(code -X POST "$base/internal/provider/chesscom/lookup")"
  expect "[$p] signed /internal/provider/chesscom/lookup" "$worker_code" \
    "$(code -X POST -H 'X-Rc-Sig: x' -d '{"v":1}' "$base/internal/provider/chesscom/lookup")"
  expect "[$p] unsigned /internal/dev/fault" 401 "$(code -X POST "$base/internal/dev/fault")"
  expect "[$p] signed /internal/dev/fault" "$dev_code" "$(code -X POST -H 'X-Rc-Sig: x' -d '{"v":1}' "$base/internal/dev/fault")"
  expect "[$p] signed /internal/load" 404 "$(code -H 'X-Rc-Sig: x' "$base/internal/load")"
done
exit "$fail"
