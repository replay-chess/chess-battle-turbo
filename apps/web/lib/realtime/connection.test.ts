// The socket is built after socket.io-client loads on the first hold (phase-04 plan §9.6; FIX-1): handlers registered
// before that are attached when it is built, and nothing is loaded or connected without a hold.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadSocketIo, RealtimeConnection } from "./connection";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("RealtimeConnection lazy socket.io", () => {
  it("regression: socket-io-eager (FIX-1): on() before a hold builds nothing; the first hold loads, builds and attaches", async () => {
    const conn = new RealtimeConnection({ url: "http://127.0.0.1:9", buildId: "test", fetchToken: async () => null });
    const seen: unknown[] = [];
    conn.on<{ n: number }>("import:progress", (p) => seen.push(p));
    type Sock = { listeners(e: string): unknown[] };
    const socket = () => (conn as unknown as { socket: Sock | null }).socket;
    assert.equal(socket(), null, "no socket without a hold");
    assert.equal(conn.getState(), "idle");
    const release = conn.acquire("user");
    assert.equal(conn.getState(), "connecting");
    await loadSocketIo();
    await tick();
    const built = socket();
    assert.ok(built, "built after the load");
    assert.equal(built.listeners("import:progress").length, 1, "the early handler is attached");
    const off = conn.on("games:changed", () => {});
    assert.equal(built.listeners("games:changed").length, 1);
    off();
    assert.equal(built.listeners("games:changed").length, 0);
    release();
    conn.destroy();
    assert.equal(conn.getState(), "idle");
  });
});
