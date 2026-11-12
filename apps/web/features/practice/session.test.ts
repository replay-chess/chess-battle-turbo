import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readSession, sessionKey, SESSION_MAX_MOVES, writeSession } from "./session";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function memory() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

describe("practice session resume", () => {
  it("round-trips the moves per URL", () => {
    const s = memory();
    const key = sessionKey("/practice?game=abc&ply=4");
    writeSession(key, { startFen: START, moves: ["e2e4", "e7e5"] }, s);
    assert.deepEqual(readSession(key, START, s), { startFen: START, moves: ["e2e4", "e7e5"] });
    writeSession(key, { startFen: START, moves: [] }, s);
    assert.equal(s.m.size, 0, "a reset forgets it");
  });

  it("ignores another start, illegal moves, junk and over-long lines", () => {
    const s = memory();
    const key = sessionKey("/practice?fen=x");
    s.setItem(key, JSON.stringify({ startFen: START, moves: ["e2e4", "e2e4"] }));
    assert.equal(readSession(key, START, s), null);
    s.setItem(key, JSON.stringify({ startFen: "8/8/8/8/8/8/8/k6K w - - 0 1", moves: [] }));
    assert.equal(readSession(key, START, s), null);
    s.setItem(key, "{not json");
    assert.equal(readSession(key, START, s), null);
    s.setItem(key, JSON.stringify({ startFen: START, moves: Array(SESSION_MAX_MOVES + 1).fill("e2e4") }));
    assert.equal(readSession(key, START, s), null);
    assert.equal(readSession(key, START, null), null);
  });

  it("a storage that throws never breaks practice", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => undefined,
    };
    assert.equal(readSession("k", START, throwing), null);
    assert.doesNotThrow(() => writeSession("k", { startFen: START, moves: ["e2e4"] }, throwing));
  });
});
