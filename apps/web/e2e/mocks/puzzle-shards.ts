// CI puzzle shard server (phase-05 plan §9.3, §12.3).
//
// The shard loader (lib/train/puzzles.server.ts) fetches shards on the SERVER, so a browser-level page.route cannot
// stand in for R2. Playwright starts this static server as a webServer on 4012 (+ E2E_PORT_OFFSET) and the web server
// gets PUZZLE_SHARD_BASE_URL=http://127.0.0.1:<port>/puzzles. It serves the committed 6-theme × 7-band subset in
// packages/chess-fixtures/puzzles/shards/<version>/ with R2's headers (immutable cache, application/json):
//
//   GET  /puzzles/<version>/manifest.json, /puzzles/<version>/<theme>/<band>.json   (HEAD too)
//   GET  /__health                                → { ok: true, versions, files }
//   GET  /__requests?since=<epoch ms>             → { requests: [{ method, path, status, at }] } (cold/warm checks)
//   POST /__faults { match, status?, delayMs?, times? }  a path regex answers `status` (default 503) or waits
//                                                 `delayMs` first, `times` times (default: until cleared)
//   DELETE /__faults                              → clears the faults; DELETE /__requests clears the log
//
// Run standalone: `npx tsx e2e/mocks/puzzle-shards.ts [--port 4012] [--dir <shards root>]`. Int tests start it in
// process with startPuzzleShardServer({ port: 0 }). It never reads the network and nothing here reaches R2.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_PUZZLE_SHARDS_PORT } from "./puzzle-shards-client";

export const SHARD_FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/chess-fixtures/puzzles/shards",
);
const IMMUTABLE = "public, max-age=31536000, immutable";
const SHARD_PATH = /^\/puzzles\/(v[0-9]{1,3})\/(manifest\.json|[A-Za-z][A-Za-z0-9]{1,29}\/[0-9]{1,2}\.json)$/;
const MAX_REQUESTS = 5_000;

export type ShardRequest = { method: string; path: string; status: number; at: number };
export type ShardFault = { match: string; status?: number; delayMs?: number; times?: number };

type LoadedFault = { re: RegExp; status: number | null; delayMs: number; left: number };

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Every file under the shards root, keyed by its served path (`/puzzles/v1/fork/14.json`). */
function loadFiles(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  if (!existsSync(dir)) throw new Error(`no shard fixtures at ${dir}`);
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs)) {
      const a = path.join(abs, name);
      const r = `${rel}/${name}`;
      if (statSync(a).isDirectory()) walk(a, r);
      else if (name.endsWith(".json")) files.set(`/puzzles${r}`, readFileSync(a));
    }
  };
  walk(dir, "");
  return files;
}

export function createPuzzleShardServer(options: { dir?: string } = {}) {
  const files = loadFiles(options.dir ?? SHARD_FIXTURES_DIR);
  const requests: ShardRequest[] = [];
  let faults: LoadedFault[] = [];
  const versions = [...new Set([...files.keys()].map((k) => k.split("/")[2]))].sort();

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://shards.local");
    const p = url.pathname;
    try {
      if (p === "/__health") return json(res, 200, { ok: true, versions, files: files.size });
      if (p === "/__requests" && req.method === "DELETE") {
        requests.length = 0;
        return json(res, 200, { ok: true });
      }
      if (p === "/__requests") {
        const since = Number(url.searchParams.get("since") ?? 0);
        return json(res, 200, { requests: requests.filter((r) => r.at >= since) });
      }
      if (p === "/__faults" && req.method === "DELETE") {
        faults = [];
        return json(res, 200, { ok: true });
      }
      if (p === "/__faults" && req.method === "POST") {
        const f = JSON.parse(await readBody(req)) as ShardFault;
        if (typeof f.match !== "string" || !f.match) return json(res, 400, { error: "match is required" });
        faults.push({
          re: new RegExp(f.match),
          status: f.status ?? (f.delayMs ? null : 503),
          delayMs: f.delayMs ?? 0,
          left: f.times ?? Number.POSITIVE_INFINITY,
        });
        return json(res, 200, { ok: true, faults: faults.length });
      }

      const record = (status: number) => {
        requests.push({ method: req.method ?? "GET", path: p, status, at: Date.now() });
        if (requests.length > MAX_REQUESTS) requests.splice(0, requests.length - MAX_REQUESTS);
      };
      if (req.method !== "GET" && req.method !== "HEAD") {
        record(405);
        return json(res, 405, { error: "method_not_allowed" });
      }
      const fault = faults.find((f) => f.left > 0 && f.re.test(p));
      if (fault) {
        fault.left -= 1;
        if (fault.delayMs) await new Promise((r) => setTimeout(r, fault.delayMs));
        if (fault.status !== null) {
          record(fault.status);
          return json(res, fault.status, { error: "fault" });
        }
      }
      const body = SHARD_PATH.test(p) ? files.get(p) : undefined;
      if (!body) {
        record(404);
        // R2's public bucket answers 404 with an XML body; the loader only looks at the status.
        res.writeHead(404, { "content-type": "application/xml" });
        return res.end("<Error><Code>NoSuchKey</Code></Error>");
      }
      record(200);
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": IMMUTABLE,
        "content-length": String(body.length),
        etag: `"${body.length.toString(16)}-${p.length.toString(16)}"`,
      });
      return res.end(req.method === "HEAD" ? undefined : body);
    } catch (err) {
      return json(res, 400, { error: "bad_request", message: err instanceof Error ? err.message : String(err) });
    }
  });

  return {
    server,
    requests,
    files,
    listen(port = DEFAULT_PUZZLE_SHARDS_PORT, host = "127.0.0.1") {
      return new Promise<number>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          const addr = server.address();
          resolve(typeof addr === "object" && addr ? addr.port : port);
        });
      });
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** In-process server for int tests; `port: 0` picks a free port. Returns the base URL the loader takes. */
export async function startPuzzleShardServer(options: { port?: number; dir?: string } = {}) {
  const s = createPuzzleShardServer({ dir: options.dir });
  const port = await s.listen(options.port ?? 0);
  return { ...s, port, origin: `http://127.0.0.1:${port}`, baseUrl: `http://127.0.0.1:${port}/puzzles` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const at = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const port = Number(at("--port") ?? DEFAULT_PUZZLE_SHARDS_PORT);
  const s = createPuzzleShardServer({ dir: at("--dir") });
  s.listen(port)
    .then((p) => console.log(`[puzzle-shards] serving ${s.files.size} files on http://127.0.0.1:${p}/puzzles`))
    .catch((err) => {
      console.error(`[puzzle-shards] ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
