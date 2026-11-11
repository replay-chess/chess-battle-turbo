// Unit tests of the e2e socket fixture's environment (phase-02 plan 12.0: the fixture servers are test hooks).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { describe, it } from "node:test";
import { io } from "socket.io-client";
import { REFUSED_FRAME, SocketFixtureError, socketDatabaseUrl, socketServerEnv } from "./socket-server";

const LOCAL = "postgresql://u:p@localhost:5432/replay";

describe("e2e socket fixture env", () => {
  it("refuses every database but a local Postgres or the Neon dev endpoint", () => {
    assert.equal(socketDatabaseUrl({ E2E_SOCKET_DATABASE_URL: LOCAL }), LOCAL);
    const dev = "postgresql://u:p@ep-fancy-dust-b8b3dp81-pooler.c-14.us-east-1.aws.neon.tech/db";
    assert.equal(socketDatabaseUrl({ E2E_SOCKET_DATABASE_URL: dev }), dev);
    for (const bad of ["postgresql://u:p@ep-other-123.us-east-1.aws.neon.tech/db", "postgresql://u:p@db.example.com/x"]) {
      assert.throws(() => socketDatabaseUrl({ E2E_SOCKET_DATABASE_URL: bad }), SocketFixtureError);
    }
  });

  it("main is real-timing with v1; fast and restartable are TIMING_PROFILE=fast with v1 off, all APP_ENV=test", () => {
    const prev = process.env.E2E_SOCKET_DATABASE_URL;
    const prevSecret = process.env.SOCKET_TOKEN_SECRET;
    process.env.E2E_SOCKET_DATABASE_URL = LOCAL;
    try {
      // regression: REGRESSION-2 — a server without the token secret refused every handshake silently.
      delete process.env.SOCKET_TOKEN_SECRET;
      assert.throws(() => socketServerEnv("fast", { strict: true }), SocketFixtureError);
      process.env.SOCKET_TOKEN_SECRET = "t1:dGVzdA==";
      assert.equal(socketServerEnv("fast").SOCKET_TOKEN_SECRET, "t1:dGVzdA==");
      const main = socketServerEnv("main");
      assert.equal(main.APP_ENV, "test");
      assert.equal(main.PORT, "3002");
      assert.equal(main.PROTOCOL_V1, "on");
      assert.equal(main.TIMING_PROFILE, undefined);
      assert.equal(main.SENTRY_DSN, "");
      for (const kind of ["fast", "restartable"] as const) {
        const e = socketServerEnv(kind);
        assert.equal(e.APP_ENV, "test");
        assert.equal(e.TIMING_PROFILE, "fast");
        assert.equal(e.PROTOCOL_V1, "off");
        assert.match(e.INTERNAL_API_SECRET!, /(^|,)ops:/);
        assert.match(e.POSTHOG_HOST!, /^http:\/\/127\.0\.0\.1:/);
      }
      // FIX-A: the v1 server's LEGACY secret is the web's INTERNAL_API_SECRET verbatim (the web compares the
      // x-internal-token header with it as a string); the v2-only servers get none.
      const prevInt = process.env.INTERNAL_API_SECRET;
      const prevLegacy = process.env.LEGACY_INTERNAL_API_SECRET;
      delete process.env.LEGACY_INTERNAL_API_SECRET;
      process.env.INTERNAL_API_SECRET = "web:d2Vi";
      try {
        assert.equal(socketServerEnv("main").LEGACY_INTERNAL_API_SECRET, "web:d2Vi");
        assert.equal(socketServerEnv("fast").LEGACY_INTERNAL_API_SECRET, undefined);
        process.env.INTERNAL_API_SECRET = "bare-shared";
        assert.equal(socketServerEnv("main").LEGACY_INTERNAL_API_SECRET, "bare-shared");
      } finally {
        if (prevInt === undefined) delete process.env.INTERNAL_API_SECRET;
        else process.env.INTERNAL_API_SECRET = prevInt;
        if (prevLegacy !== undefined) process.env.LEGACY_INTERNAL_API_SECRET = prevLegacy;
      }
      assert.equal(socketServerEnv("fast").PORT, "3102");
      assert.equal(socketServerEnv("restartable").PORT, "3103");
    } finally {
      if (prevSecret === undefined) delete process.env.SOCKET_TOKEN_SECRET;
      else process.env.SOCKET_TOKEN_SECRET = prevSecret;
      if (prev === undefined) delete process.env.E2E_SOCKET_DATABASE_URL;
      else process.env.E2E_SOCKET_DATABASE_URL = prev;
    }
  });

});

// regression: restart-resume (CI run 43037495714). A behavioural check of REFUSED_FRAME with the app's socket.io-client
// options: a server that accepts the WebSocket upgrade and closes it before the engine.io handshake. With the frame,
// the client counts a failed transport and retries on its backoff; with a clean close only, it waits out its connect
// timeout (10 s in the app), which is what abandoned a player across a restart.
describe("the link's refused connection", () => {
  type Mode = "refuse" | "clean";

  /** A WebSocket endpoint that closes every upgrade (after REFUSED_FRAME in "refuse" mode); counts the upgrades. */
  async function closingServer(mode: Mode): Promise<{ url: string; upgrades(): number; close(): Promise<void> }> {
    let upgrades = 0;
    const sockets = new Set<Socket>();
    const server = createServer((_req, res) => {
      res.writeHead(503).end(); // the polling fallback is refused too, as the link aborts it
    });
    server.on("upgrade", (req, socket: Socket) => {
      upgrades++;
      sockets.add(socket);
      const accept = createHash("sha1")
        .update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      const frames: Buffer[] = [];
      if (mode === "refuse") frames.push(Buffer.from([0x81, REFUSED_FRAME.length]), Buffer.from(REFUSED_FRAME));
      frames.push(Buffer.from([0x88, 0x02, 0x03, 0xe8])); // close 1000
      socket.end(Buffer.concat(frames));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}`,
      upgrades: () => upgrades,
      close: () =>
        new Promise<void>((resolve) => {
          for (const sock of sockets) sock.destroy();
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    };
  }

  async function attemptsWithin(mode: Mode, ms: number): Promise<number> {
    const srv = await closingServer(mode);
    // apps/web/lib/realtime/connection.ts options, with a short backoff and a 3 s connect timeout.
    const s = io(srv.url, {
      transports: ["websocket", "polling"],
      upgrade: false,
      tryAllTransports: true,
      reconnectionDelay: 100,
      reconnectionDelayMax: 200,
      randomizationFactor: 0,
      timeout: 3_000,
    });
    await new Promise((r) => setTimeout(r, ms));
    s.close();
    await srv.close();
    return srv.upgrades();
  }

  it("with the refusal frame the client retries on its backoff; with a clean close it waits for its timeout", async () => {
    const refused = await attemptsWithin("refuse", 1_500);
    const clean = await attemptsWithin("clean", 1_500);
    assert.ok(refused >= 3, `refused: ${refused} attempts in 1.5 s`);
    assert.equal(clean, 1, "a clean close before the handshake is not a failed attempt");
  });
});
