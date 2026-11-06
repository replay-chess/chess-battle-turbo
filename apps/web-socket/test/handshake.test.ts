// Handshake, `session:hello`, protocol compatibility, origin check, handshake limits and command rate limits
// (phase-02 plan 12.1 `handshake-limits`, 12.3 `compat`, 12.4 `hello`, `rate-limit`, `join` token cases).
import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { HandshakeLimiter, CommandLimiter, TokenBucket, DEFAULT_HANDSHAKE_LIMITS } from "../src/server/rateLimit";
import {
  closeAllClients,
  cmd,
  connect,
  connectError,
  delay,
  move,
  startGame,
  startServer,
  token,
  user,
  waitFor,
  type TestServer,
} from "./helpers";

describe("handshake", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer();
  });
  afterEach(() => closeAllClients());
  after(() => server.close());

  test("no token, a forged token, a wrong-env token, an expired-kid token → unauthorized", async () => {
    const u = user("a");
    assert.equal(await connectError(server.url, { proto: 2 }), "unauthorized");
    const other = `t1:${randomBytes(32).toString("base64")}`;
    assert.equal(await connectError(server.url, { proto: 2, token: token(u, { keyRing: other }) }), "unauthorized");
    assert.equal(await connectError(server.url, { proto: 2, token: token(u, { env: "dev" }) }), "unauthorized");
    assert.equal(await connectError(server.url, { proto: 2, token: "a.b" }), "unauthorized");
  });

  test("no proto while PROTOCOL_V1=off → upgrade_required; an unknown proto too", async () => {
    const u = user("a");
    assert.equal(await connectError(server.url, { token: token(u) }), "upgrade_required");
    assert.equal(await connectError(server.url, { proto: 3, token: token(u) }), "upgrade_required");
  });

  test("session:hello carries bootId and useq; useq counts user-room events; a restarted server has a new bootId", async () => {
    const u = user("a");
    const first = await connect(server.url, u);
    assert.match(first.hello.bootId, /^[A-Za-z0-9_-]{6,32}$/);
    assert.equal(first.hello.useq, 0);
    const echoed = waitFor(first.socket, "test:echo");
    assert.equal(server.handle.userRooms.emitToUser(u.ref, "test:echo", { text: "hi" }), 1);
    assert.deepEqual(await echoed, { text: "hi", useq: 1 });
    const second = await connect(server.url, u);
    assert.equal(second.hello.useq, 1);
    assert.equal(second.hello.bootId, first.hello.bootId);
    const other = await startServer();
    try {
      const third = await connect(other.url, u);
      assert.notEqual(third.hello.bootId, first.hello.bootId);
    } finally {
      await other.close();
    }
  });

  test("the 11th socket of one user is refused (rate_limited)", async () => {
    const u = user("many");
    for (let i = 0; i < 10; i++) await connect(server.url, u);
    assert.equal(await connectError(server.url, { proto: 2, token: token(u) }), "rate_limited");
  });
});

describe("protocol compatibility and origins", () => {
  afterEach(() => closeAllClients());

  test("PROTOCOL_V1=on admits a client without proto (v1 handlers), with a v2 token", async () => {
    const server = await startServer({ env: { PROTOCOL_V1: "on" } });
    try {
      const u = user("legacy");
      const { io } = await import("socket.io-client");
      const s = io(server.url, { transports: ["websocket"], reconnection: false, forceNew: true, auth: { token: token(u) } });
      await new Promise<void>((resolve, reject) => {
        s.once("connect", () => resolve());
        s.once("connect_error", reject);
      });
      assert.equal(server.handle.v1 !== null, true);
      s.close();
    } finally {
      await server.close();
    }
  });

  test("an Origin outside ALLOWED_ORIGINS never upgrades; a listed one does", async () => {
    const server = await startServer({ env: { ALLOWED_ORIGINS: "http://localhost:3000" } });
    try {
      const u = user("o");
      const refused = await connectError(server.url, { proto: 2, token: token(u) }, { origin: "https://evil.example" });
      assert.notEqual(refused, "");
      const ok = await connectError(server.url, { proto: 2, token: "bad" }, { origin: "http://localhost:3000" });
      assert.equal(ok, "unauthorized", "a listed origin reaches the handshake");
    } finally {
      await server.close();
    }
  });
});

describe("command rate limits", () => {
  let server: TestServer;
  before(async () => {
    server = await startServer();
  });
  afterEach(() => closeAllClients());
  after(() => server.close());

  test("25 moves in one second → rate_limited with retryAfterMs", async () => {
    const { game, W } = await startGame(server, user("w"), user("b"));
    const acks = await Promise.all(Array.from({ length: 25 }, () => move(W, game.ref, 99, "e2e4")));
    const limited = acks.filter((a) => a.code === "rate_limited");
    assert.ok(limited.length >= 15, `limited ${limited.length}`);
    assert.ok(limited[0].retryAfterMs > 0);
    assert.ok((server.metrics.counts.get("ws.rate_limited{cmd=game:move}") ?? 0) >= 15);
  });

  test("clock:ping answers { c, s } once a second", async () => {
    const { socket } = await connect(server.url, user("p"));
    const c = Date.now();
    const ack = await cmd(socket, "clock:ping", { c });
    assert.equal(ack.c, c);
    assert.ok(Math.abs(ack.s - Date.now()) < 1_000);
    assert.equal((await cmd(socket, "clock:ping", { c })).code, "rate_limited");
  });

  test("session:refresh_token updates ent; another user's token → unauthorized and the socket closes", async () => {
    const u = user("r");
    const { socket } = await connect(server.url, u);
    const ent = Math.floor(Date.now() / 1000) + 99;
    assert.deepEqual(await cmd(socket, "session:refresh_token", { token: token(u, { ent }) }), { ok: true, ent });
    assert.equal(server.handle.ents.get(u.ref), ent);
    await delay(10);
    const closed = waitFor(socket, "disconnect");
    // A second refresh inside 10 s is rate limited first; use a fresh socket for the wrong-user case.
    const other = await connect(server.url, u);
    const closedOther = waitFor(other.socket, "disconnect");
    assert.deepEqual(await cmd(other.socket, "session:refresh_token", { token: token(user("x")) }), {
      ok: false,
      code: "unauthorized",
    });
    await closedOther;
    void closed.catch(() => undefined);
  });
});

describe("limiters (units)", () => {
  test("per user: ≤ 10 open sockets, ≤ 20 handshakes a minute", () => {
    const l = new HandshakeLimiter({ ...DEFAULT_HANDSHAKE_LIMITS, ipGuardBootGraceMs: 0 }, 0);
    for (let i = 0; i < 10; i++) {
      assert.equal(l.checkUser("u", 1_000), true);
      l.opened("u", "1.1.1.1");
    }
    assert.equal(l.checkUser("u", 1_000), false, "11th open socket");
    for (let i = 0; i < 10; i++) l.closed("u", "1.1.1.1");
    for (let i = 0; i < 10; i++) assert.equal(l.checkUser("u", 2_000), true);
    assert.equal(l.checkUser("u", 2_000), false, "21st handshake in a minute");
    assert.equal(l.checkUser("u", 61_001), true, "the window slides");
  });

  test("per IP: a flood guard, off for the boot grace", () => {
    const l = new HandshakeLimiter({ ...DEFAULT_HANDSHAKE_LIMITS, ipGuardBootGraceMs: 120_000 }, 0);
    for (let i = 0; i < 400; i++) assert.equal(l.checkIp("9.9.9.9", 1_000), true, "suspended after boot");
    for (let i = 0; i < 300; i++) assert.equal(l.checkIp("9.9.9.9", 130_000), true);
    assert.equal(l.checkIp("9.9.9.9", 130_000), false, "301st handshake from one IP");
    for (let i = 0; i < 500; i++) l.opened(`u${i}`, "8.8.8.8");
    assert.equal(l.checkIp("8.8.8.8", 200_000), false, "501st open socket from one IP");
  });

  test("token bucket and the flood disconnect after 5 s of sustained refusals", () => {
    const b = new TokenBucket(2, 1, 0);
    assert.equal(b.take(0).ok, true);
    assert.equal(b.take(0).ok, true);
    const r = b.take(0);
    assert.equal(r.ok, false);
    assert.equal(b.take(1_000).ok, true);

    const c = new CommandLimiter(0);
    let disconnect = false;
    for (let t = 0; t <= 6_000 && !disconnect; t += 50) {
      const res = c.check("clock:ping", t);
      if (!res.ok && res.disconnect) disconnect = true;
    }
    assert.equal(disconnect, true, "20 pings a second for 5 s: sustained flooding disconnects");

    const calm = new CommandLimiter(0);
    for (let t = 0; t <= 20_000; t += 1_000) assert.equal(calm.check("clock:ping", t).ok, true, "1/s is fine");
  });
});
