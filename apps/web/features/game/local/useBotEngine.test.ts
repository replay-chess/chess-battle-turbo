import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SharedEngine } from "@/features/engine/EngineProvider";
import type { EngineInitInfo, EngineProgress, EngineSearch, EngineSearchResult } from "@/features/engine/uci";
import { lazyEngineHost } from "./useBotEngine";

/** A fake shared engine that records calls, behind a load the test resolves by hand. */
function fakeLoad() {
  const calls: string[] = [];
  let holds = 0;
  const listeners = new Set<(p: EngineProgress | null) => void>();
  const engine = {
    init: async () => {
      calls.push("init");
      return { eloFloor: 1320 } as EngineInitInfo;
    },
    search: async (job: EngineSearch) => {
      calls.push(`search ${job.go}`);
      return { cancelled: false, best: "e2e4", lines: [] } as unknown as EngineSearchResult;
    },
    newGame: () => void calls.push("newGame"),
    retain: () => {
      holds++;
      calls.push("retain");
      return () => {
        holds--;
        calls.push("release");
      };
    },
    retry: async () => {
      calls.push("retry");
      return { eloFloor: 1320 } as EngineInitInfo;
    },
    status: () => "ready" as const,
    subscribeProgress: (l: (p: EngineProgress | null) => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  } as unknown as SharedEngine;
  let resolve!: (e: SharedEngine) => void;
  let loads = 0;
  const promise = new Promise<SharedEngine>((r) => (resolve = r));
  return {
    calls,
    holds: () => holds,
    listeners,
    load: () => {
      loads++;
      return promise;
    },
    loads: () => loads,
    finish: async () => {
      resolve(engine);
      await promise;
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const job = (go: string) => ({ startFen: "startpos", moves: [], options: [], go, multiPv: 1 }) as EngineSearch;

describe("lazyEngineHost (the engine glue stays a lazy chunk of the bot screen)", () => {
  it("imports nothing until it is used, then loads once", async () => {
    const f = fakeLoad();
    const host = lazyEngineHost(f.load);
    assert.equal(f.loads(), 0);
    assert.equal(host.status(), "idle");
    void host.init();
    void host.search(job("go nodes 1"));
    assert.equal(f.loads(), 1);
    await f.finish();
    assert.equal(host.status(), "ready");
  });

  it("runs the calls made before the chunk is in, in the order they were made", async () => {
    const f = fakeLoad();
    const host = lazyEngineHost(f.load);
    host.newGame();
    const ready = host.init();
    const searched = host.search(job("go nodes 2"));
    assert.deepEqual(f.calls, []);
    await f.finish();
    await Promise.all([ready, searched]);
    assert.deepEqual(f.calls, ["newGame", "init", "search go nodes 2"]);
  });

  it("a retain released before the load never holds the engine; one released after does", async () => {
    const f = fakeLoad();
    const host = lazyEngineHost(f.load);
    const early = host.retain();
    early();
    const late = host.retain();
    const unsubscribe = host.subscribeProgress(() => undefined);
    await f.finish();
    assert.equal(f.holds(), 1, "only the retain still held when the engine arrived");
    assert.equal(f.listeners.size, 1);
    late();
    unsubscribe();
    assert.equal(f.holds(), 0);
    assert.equal(f.listeners.size, 0);
    late();
    assert.deepEqual(f.calls, ["retain", "release"], "a release is idempotent");
  });
});
