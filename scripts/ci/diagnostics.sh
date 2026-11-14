#!/usr/bin/env bash
# CI diagnostics (ci.yml; owner request after run 43599091643, where devices-game said only "Process from
# config.webServer was not able to start"). Every job that starts servers or runs Playwright calls:
#
#   scripts/ci/diagnostics.sh env "<what binds which port>"   first: tool versions, commit, env NAMES, the ports
#   scripts/ci/diagnostics.sh failure                         if: failure(): containers and ports, the tail of every
#                                                             server log in its own ::group::, then redacts the files
#
# Server logs live in $E2E_LOG_DIR (the Playwright configs tee each server there, e2e/fixtures/server-logs.ts). Nothing
# here prints a value from the environment or an env file. Before anything is printed or uploaded, the files are
# redacted: credentials in database URLs, Clerk / Dodo / webhook keys, the socket and internal key rings, and
# `NAME=value` pairs whose name says secret, password, token or key. It never changes the job's outcome (exit 0).
set -uo pipefail

LOG_DIR="${E2E_LOG_DIR:-${GITHUB_WORKSPACE:-$PWD}/ci-logs}"
mkdir -p "$LOG_DIR"

redact() {
  local f
  while IFS= read -r -d '' f; do
    sed -i -E \
      -e 's#(postgres(ql)?://)[^@/[:space:]"]+@#\1***@#g' \
      -e 's#\b(sk|rk)_(test|live)_[A-Za-z0-9]+#\1_\2_***#g' \
      -e 's#whsec_[A-Za-z0-9+/=]+#whsec_***#g' \
      -e 's#\b(d1|web|ws|wk|webwk):[A-Za-z0-9+/]{20,}={0,2}#\1:***#g' \
      -e 's#\b([A-Z0-9_]*(SECRET|PASSWORD|TOKEN|PEPPER|_KEY)[A-Z0-9_]*)=[^[:space:]"]+#\1=***#g' \
      "$f"
  done < <(find "$LOG_DIR" -type f \( -name '*.log' -o -name '*.txt' \) -print0)
}

case "${1:-}" in
  env)
    echo "::group::environment"
    echo "commit: ${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null)}  ref: ${GITHUB_REF:-?}  job: ${GITHUB_JOB:-?}  runner: ${RUNNER_NAME:-?} (${RUNNER_OS:-?}/${RUNNER_ARCH:-?})"
    echo "node $(node --version 2>/dev/null || echo '?')  pnpm $(pnpm --version 2>/dev/null || echo '?')  docker $(docker --version 2>/dev/null | cut -d' ' -f3 | tr -d , || echo '?')"
    echo "server logs: $LOG_DIR"
    echo "ports: ${2:-none}"
    echo "env names (values never printed):"
    env | cut -d= -f1 | grep -Ev '^(GITHUB_|RUNNER_|ACTIONS_|INPUT_|STATE_|HOME$|PATH$|PWD$|OLDPWD$|SHLVL$|_$|HOSTNAME$|USER$|LANG$|LC_|TERM$|SHELL$|LOGNAME$|JAVA_|ANDROID|CHROME|GECKO|DOTNET|XDG_|SWIFT|CONDA|VCPKG|PIPX|POWERSHELL|AGENT_|ImageOS|ImageVersion|DEBIAN_FRONTEND|SYSTEMD|INVOCATION_ID|JOURNAL_STREAM|MEMORY_PRESSURE|NVM_|GOROOT|BOOTSTRAP|ACCEPT_EULA|AZURE|ANT_HOME|CI$|SGX|LEIN|HOMEBREW|SELENIUM|EDGEWEBDRIVER|RUSTUP|CARGO|GRADLE|M2_|PSModulePath|NODE_PATH$|PNPM_HOME$|npm_)' | sort | tr '\n' ' '
    echo
    echo "::endgroup::"
    ;;
  failure)
    docker ps -a > "$LOG_DIR/docker-ps.txt" 2>&1 || true
    for id in $(docker ps -aq 2>/dev/null); do
      name="$(docker inspect --format '{{.Name}}' "$id" 2>/dev/null | tr -d / | tr -c 'A-Za-z0-9._-\n' _)"
      docker logs "$id" > "$LOG_DIR/docker-${name:-$id}.log" 2>&1 || true
    done
    (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null || lsof -iTCP -sTCP:LISTEN -P 2>/dev/null) > "$LOG_DIR/listening-ports.txt" || true
    redact
    echo "::group::docker ps -a"; cat "$LOG_DIR/docker-ps.txt"; echo "::endgroup::"
    echo "::group::listening ports"; cat "$LOG_DIR/listening-ports.txt"; echo "::endgroup::"
    found=0
    while IFS= read -r f; do
      found=1
      echo "::group::$(basename "$f" .log) (last 200 lines of $(wc -l < "$f") — $f)"
      tail -n 200 "$f"
      echo "::endgroup::"
    done < <(find "$LOG_DIR" -type f -name '*.log' | sort)
    [ "$found" = 1 ] || echo "no server logs in $LOG_DIR"
    ;;
  redact)
    redact
    ;;
  *)
    echo "usage: $0 env \"<ports>\" | failure | redact" >&2
    exit 2
    ;;
esac
exit 0
