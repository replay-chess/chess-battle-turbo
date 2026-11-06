// The ops signing CLI (phase-02 plan 7.5, 7.11), run INSIDE the socket container so no key ever reaches a CI log:
//
//   docker compose exec -T websocket node dist/cli/internal.js broadcast --in 30
//   docker compose exec -T websocket node dist/cli/internal.js drain
//   docker compose exec -T websocket node dist/cli/internal.js metrics
//   docker compose exec -T websocket node dist/cli/internal.js emit-echo --user <ref> [--text hi]   (dev/test only)
//
// It signs with the `ops` key of INTERNAL_API_SECRET (the container's env; `--kid web` for emit-echo) through
// @repo/contracts/internal/auth and calls http://127.0.0.1:$PORT. Prints the status and the JSON answer (never a
// key); exits 1 on anything but 2xx.
import { parseKeyRing, signInternal } from "@repo/contracts/internal/auth";

const USAGE = `usage: internal.js <broadcast --in <5..600> | drain | metrics | emit-echo --user <ref> [--text <t>]> [--url <base>] [--kid <kid>]`;

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export interface CliRequest {
  method: "GET" | "POST";
  path: string;
  body: string;
  kid: string;
}

export function requestFor(args: string[]): CliRequest | { error: string } {
  const [command] = args;
  const kid = arg(args, "kid");
  switch (command) {
    case "broadcast": {
      const inSeconds = Number(arg(args, "in") ?? "30");
      if (!Number.isInteger(inSeconds) || inSeconds < 5 || inSeconds > 600) return { error: "--in must be 5..600" };
      return { method: "POST", path: "/internal/broadcast", body: JSON.stringify({ v: 1, type: "restart", inSeconds }), kid: kid ?? "ops" };
    }
    case "drain":
      return { method: "POST", path: "/internal/drain", body: JSON.stringify({ v: 1 }), kid: kid ?? "ops" };
    case "metrics":
      return { method: "GET", path: "/internal/metrics", body: "", kid: kid ?? "ops" };
    case "emit-echo": {
      const userRef = arg(args, "user");
      if (!userRef) return { error: "--user <ref> is required" };
      const body = { v: 1, targets: [{ userRef }], event: "test:echo", data: { text: arg(args, "text") ?? "echo", at: Date.now() } };
      return { method: "POST", path: "/internal/emit", body: JSON.stringify(body), kid: kid ?? "web" };
    }
    default:
      return { error: USAGE };
  }
}

async function main(argv: string[]): Promise<number> {
  const req = requestFor(argv);
  if ("error" in req) {
    console.error(req.error);
    return 2;
  }
  let keys;
  try {
    keys = parseKeyRing(process.env.INTERNAL_API_SECRET);
  } catch (error) {
    console.error(`INTERNAL_API_SECRET: ${error instanceof Error ? error.message : "invalid"}`);
    return 2;
  }
  if (!keys.keys.has(req.kid)) {
    console.error(`INTERNAL_API_SECRET has no "${req.kid}" key`);
    return 2;
  }
  const base = (arg(argv, "url") ?? `http://127.0.0.1:${process.env.PORT ?? "3002"}`).replace(/\/+$/, "");
  const headers = signInternal({ keys, method: req.method, path: req.path, body: req.body, nowMs: Date.now(), kid: req.kid });
  const res = await fetch(`${base}${req.path}`, {
    method: req.method,
    headers: { ...headers, ...(req.body ? { "content-type": "application/json" } : {}) },
    ...(req.method === "POST" ? { body: req.body } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  console.log(`${res.status} ${text}`);
  return res.ok ? 0 : 1;
}

const isEntry = (() => {
  const entry = process.argv[1] ?? "";
  return /cli[\\/]internal\.(js|ts|mjs)$/.test(entry);
})();
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`request failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
