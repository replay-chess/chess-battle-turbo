// The devices-game config (game.config.ts) starts the base devices config's servers from apps/web.
// regression: devices-game-shard-cwd (CI 43599091643): Playwright runs a webServer command in the directory of the
// config that declares it unless `cwd` says otherwise. P5 turned the base's webServer into a list (next + the puzzle
// shard server) and game.config.ts set `cwd` only on a single object, so `npx tsx e2e/mocks/puzzle-shards.ts` ran under
// e2e/devices/game and the job never started (ERR_MODULE_NOT_FOUND).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import config from "./game.config";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));

describe("game.config.ts web servers", () => {
  it("every server's script resolves from the directory it runs in", () => {
    const servers = [config.webServer ?? []].flat();
    assert.ok(servers.length >= 2, "the next server and the puzzle shard server");
    for (const s of servers) {
      const cwd = path.resolve(CONFIG_DIR, s.cwd ?? ".");
      const script = /\b(e2e\/[\w/.-]+\.ts)\b/.exec(s.command)?.[1];
      if (script) assert.ok(existsSync(path.join(cwd, script)), `${s.command} from ${cwd}`);
      assert.ok(existsSync(path.join(cwd, "package.json")) && existsSync(path.join(cwd, "next.config.js")), `${s.command} runs in apps/web (${cwd})`);
    }
  });
});
