// Every command and event schema accepts its fixture and rejects a mutated one (phase-02 plan §12.1), plus the
// registry, rooms and /internal/* body invariants.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONNECT_ERROR_CODES, SOCKET_ERROR_CODES, isSocketErrorCode } from "../codes";
import { AckError, ackError, COMMAND_NAMES, COMMANDS, isCommandName, parseCommand } from "../commands";
import { GAME_EVENTS } from "../events";
import { GameState, MoveAck } from "../game";
import { BroadcastBody, DrainBody, EmitBody, TournamentEventBody } from "../internal";
import { COMMAND_BUCKET, MAX_HTTP_BUFFER_BYTES, PROTOCOL_VERSION } from "../limits";
import { EMIT_EVENTS, emitEventFor, GAME_EVENT_SPECS, SERVER_EVENT_NAMES, SERVER_EVENTS } from "../registry";
import { parseRoom, ROOM, RoomNameSchema } from "../rooms";
import { BLACK_REF, CLOCKS, COMMAND_FIXTURES, eventFixtures, GAME_REF, gameStateFixture, NEW_GAME_REF, T0 } from "./fixtures";

/** A copy with one key replaced (or removed with `undefined`). */
function mutate<T extends object>(value: T, key: string, next: unknown): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  if (next === undefined) delete copy[key];
  else copy[key] = next;
  return copy;
}

describe("commands", () => {
  it("lists the §7.4.4 commands", () => {
    assert.deepEqual([...COMMAND_NAMES].sort(), [
      "clock:ping", "draw:accept", "draw:decline", "draw:offer", "game:abort", "game:join", "game:leave", "game:move",
      "game:resign", "game:sync", "live:list", "rematch:accept", "rematch:cancel", "rematch:decline", "rematch:offer",
      "session:refresh_token", "spectate:join", "study:ready",
    ]);
    assert.equal(isCommandName("game:move"), true);
    assert.equal(isCommandName("make_move"), false);
    assert.equal(isCommandName("toString"), false);
  });

  for (const name of COMMAND_NAMES) {
    it(`${name}: accepts its fixture and rejects a mutated one`, () => {
      const fixture = COMMAND_FIXTURES[name];
      assert.equal(parseCommand(name, fixture).success, true);
      const key = Object.keys(fixture)[0] as string;
      const bad = mutate(fixture, key, { not: "valid" });
      assert.equal(parseCommand(name, bad).success, false, `${name} accepted a mutated ${key}`);
      assert.equal(parseCommand(name, null).success, false);
      assert.equal(parseCommand(name, "e2e4").success, false);
    });

    it(`${name}: every declared error code is a socket code`, () => {
      for (const code of COMMANDS[name].errors) assert.ok(isSocketErrorCode(code), code);
    });
  }

  it("game:move validates ply, UCI and clientMoveId", () => {
    const ok = COMMAND_FIXTURES["game:move"];
    assert.equal(parseCommand("game:move", { ...ok, ply: -1 }).success, false);
    assert.equal(parseCommand("game:move", { ...ok, ply: 1.5 }).success, false);
    assert.equal(parseCommand("game:move", { ...ok, uci: "e7e8k" }).success, false);
    assert.equal(parseCommand("game:move", { ...ok, uci: "e2-e4" }).success, false);
    assert.equal(parseCommand("game:move", { ...ok, clientMoveId: "x".repeat(17) }).success, false);
    assert.equal(parseCommand("game:move", { ...ok, clientMoveId: "" }).success, false);
    assert.equal(parseCommand("game:move", { ...ok, ref: "game:abc" }).success, false);
  });

  it("strips unknown keys instead of refusing them (a client one release ahead still works)", () => {
    const parsed = parseCommand("game:join", { ref: GAME_REF, lastSeq: 3, extra: true });
    assert.ok(parsed.success);
    assert.deepEqual(parsed.data, { ref: GAME_REF, lastSeq: 3 });
  });

  it("acks: ok results and negative acks parse with the command's ack schema", () => {
    const state = gameStateFixture();
    const cases: [keyof typeof COMMANDS, unknown][] = [
      ["game:join", { ok: true, role: "player", color: "w", state }],
      ["spectate:join", { ok: true, role: "spectator", state: { ...state, you: { role: "spectator" } } }],
      ["spectate:join", { ok: true, role: "player", color: "b", state }],
      ["game:leave", { ok: true }],
      ["game:sync", { ok: true, state }],
      ["study:ready", { ok: true, ready: { w: true, b: false } }],
      ["game:move", { ok: true, seq: 188, ply: 124, san: "Qxd8+", clocks: CLOCKS, clientMoveId: "m7k2x9q4w1z8p3r5" }],
      ["draw:offer", { ok: true, drawOffer: { by: "w", ply: 123 } }],
      ["draw:offer", { ok: true, drawOffer: null }],
      ["rematch:offer", { ok: true, expiresAt: T0 + 30_000 }],
      ["rematch:offer", { ok: true, newRef: NEW_GAME_REF }],
      ["rematch:accept", { ok: true, newRef: NEW_GAME_REF }],
      ["clock:ping", { ok: true, c: T0, s: T0 + 87 }],
      ["live:list", { ok: true, games: [] }],
      ["session:refresh_token", { ok: true, ent: 1_796_000_000 }],
      ["game:move", { ok: false, code: "stale_ply", state }],
      ["draw:offer", { ok: false, code: "draw_cooldown", canOfferAtPly: 127 }],
      ["game:move", { ok: false, code: "rate_limited", retryAfterMs: 400 }],
    ];
    for (const [name, ack] of cases) {
      const r = COMMANDS[name].ack.safeParse(ack);
      assert.ok(r.success, `${name}: ${JSON.stringify(r.error?.issues)}`);
    }
    assert.equal(COMMANDS["game:join"].ack.safeParse({ ok: true, role: "player", state }).success, false, "color missing");
    assert.equal(COMMANDS["game:move"].ack.safeParse({ ok: false, code: "nope" }).success, false);
    assert.equal(COMMANDS["live:list"].ack.safeParse({ ok: true, games: Array(21).fill(null) }).success, false);
    assert.deepEqual(ackError("phase"), { ok: false, code: "phase" });
    assert.equal(AckError.safeParse(ackError("illegal", { state })).success, true);
  });

  it("MoveAck has the plan's fields only", () => {
    assert.deepEqual(Object.keys(MoveAck.shape).sort(), ["clientMoveId", "clocks", "ply", "san", "seq"]);
  });
});

describe("events", () => {
  const fixtures = eventFixtures();
  for (const name of Object.keys(GAME_EVENTS) as (keyof typeof GAME_EVENTS)[]) {
    it(`${name}: accepts its fixture and rejects a mutated one`, () => {
      const schema = GAME_EVENTS[name];
      const fixture = fixtures[name] as Record<string, unknown>;
      const r = schema.safeParse(fixture);
      assert.ok(r.success, `${name}: ${JSON.stringify(r.error?.issues)}`);
      const key = "ref" in fixture ? "ref" : (Object.keys(fixture)[0] as string);
      assert.equal(schema.safeParse(mutate(fixture, key, { not: "valid" })).success, false, `${name} accepted a mutated ${key}`);
      assert.equal(schema.safeParse(mutate(fixture, key, undefined)).success, false, `${name} accepted a missing ${key}`);
    });
  }

  it("move:applied omits false flags and carries no fen and no clientMoveId", () => {
    const schema = GAME_EVENTS["move:applied"];
    const base = { seq: 1, ref: GAME_REF, ply: 1, uci: "e2e4", san: "e4", by: "w", clocks: CLOCKS };
    assert.equal(schema.safeParse(base).success, true);
    assert.equal(schema.safeParse({ ...base, check: false }).success, false, "false must be omitted, not sent");
    const parsed = schema.parse({ ...base, fen: "x", clientMoveId: "abc" });
    assert.equal("fen" in parsed, false);
    assert.equal("clientMoveId" in parsed, false);
  });

  it("every event with a seq in the registry has seq in its schema", () => {
    for (const [name, spec] of Object.entries(GAME_EVENT_SPECS)) {
      const fixture = (fixtures as Record<string, Record<string, unknown>>)[name] as Record<string, unknown>;
      assert.equal("seq" in fixture, spec.seq, `${name}: seq flag`);
    }
  });

  it("presence:update keeps P2's name (P10's watcher event is presence:state)", () => {
    assert.ok("presence:update" in GAME_EVENTS);
    assert.equal("presence:state" in SERVER_EVENTS, false);
  });
});

describe("GameState", () => {
  it("accepts the initial, 80-ply and legend-prefix fixtures", () => {
    for (const state of [gameStateFixture(), gameStateFixture({ plies: 0 }), gameStateFixture({ start: "opera" })]) {
      const r = GameState.safeParse(state);
      assert.ok(r.success, JSON.stringify(r.error?.issues));
    }
  });

  it("rejects bad moves strings, v1 states and broken clocks", () => {
    const s = gameStateFixture();
    assert.equal(GameState.safeParse({ ...s, moves: "e2e4  e7e5" }).success, false);
    assert.equal(GameState.safeParse({ ...s, moves: "e2e4 e7e5 " }).success, false);
    assert.equal(GameState.safeParse({ ...s, v: 1 }).success, false);
    assert.equal(GameState.safeParse({ ...s, clocks: { ...s.clocks, run: "x" } }).success, false);
    assert.equal(GameState.safeParse({ ...s, phase: "analysis" }).success, false);
    assert.equal(GameState.safeParse({ ...s, fen: "not a fen" }).success, false);
  });
});

describe("registry", () => {
  it("has one schema per name, and no command shares a name with an event", () => {
    assert.equal(new Set(SERVER_EVENT_NAMES).size, SERVER_EVENT_NAMES.length);
    for (const name of COMMAND_NAMES) {
      // study:ready is both a command and an event by design (§7.4.4/§7.4.5).
      if (name === "study:ready") continue;
      assert.equal(name in SERVER_EVENTS, false, `${name} is a command and an event`);
    }
    for (const name of Object.keys(EMIT_EVENTS)) assert.equal(name in GAME_EVENT_SPECS, false, name);
  });

  it("names are domain:verb in lower snake case", () => {
    for (const name of [...SERVER_EVENT_NAMES, ...COMMAND_NAMES]) assert.match(name, /^[a-z]+:[a-z_]+$/, name);
  });

  it("the emit registry: P2's test:echo (refused in production), P3's analysis events and P4's user events", () => {
    assert.deepEqual(Object.keys(EMIT_EVENTS), [
      "test:echo",
      "analysis:queued",
      "analysis:progress",
      "analysis:writing",
      "analysis:done",
      "analysis:failed",
      "analysis:batch",
      "compare:ready",
      "games:changed",
      "import:progress",
      "import:finished",
      "import:failed",
      "entitlement:changed",
    ]);
    const dev = emitEventFor("test:echo", "dev");
    assert.ok(dev.ok);
    assert.equal(dev.schema.safeParse({ text: "hi" }).success, true);
    assert.deepEqual(emitEventFor("test:echo", "production"), { ok: false, reason: "unknown" });
    assert.deepEqual(emitEventFor("move:applied", "dev"), { ok: false, reason: "unknown" }, "game events are never emitted over HTTP");
    // A later phase's event (P10 presence) is not registered yet; P4 registered entitlement:changed (user.p4.test.ts).
    assert.deepEqual(emitEventFor("presence:state", "dev"), { ok: false, reason: "unknown" });
  });

  it("every error code list is unique", () => {
    assert.equal(new Set(SOCKET_ERROR_CODES).size, SOCKET_ERROR_CODES.length);
    assert.deepEqual([...CONNECT_ERROR_CODES], ["unauthorized", "upgrade_required", "rate_limited"]);
  });
});

describe("rooms", () => {
  /* eslint-disable replay/no-room-literal -- this block checks the spelled-out names ROOM produces */
  it("builds the four room names", () => {
    assert.equal(ROOM.game(GAME_REF), `game:${GAME_REF}`);
    assert.equal(ROOM.spectate(GAME_REF), `spectate:${GAME_REF}`);
    assert.equal(ROOM.user(BLACK_REF), `user:${BLACK_REF}`);
    assert.equal(ROOM.tournament("friday-opera-arena"), "tournament:friday-opera-arena");
  });

  it("refuses ids that would break the name", () => {
    for (const bad of ["", "a:b", "a b", "x".repeat(65), "../x"]) assert.throws(() => ROOM.game(bad), /invalid id/);
  });

  it("parses names and refuses anything else", () => {
    assert.deepEqual(parseRoom(ROOM.spectate(GAME_REF)), { kind: "spectate", id: GAME_REF });
    for (const bad of ["game", "game:", ":x", "lobby:x", "game:a:b", "user:a b"]) assert.equal(parseRoom(bad), null, bad);
    /* eslint-enable replay/no-room-literal */
    assert.equal(RoomNameSchema.safeParse(ROOM.user(BLACK_REF)).success, true);
    assert.equal(RoomNameSchema.safeParse("g:abc").success, false);
    assert.equal(RoomNameSchema.safeParse(7).success, false);
  });
});

describe("/internal/* bodies", () => {
  const emit = { v: 1, targets: [{ userRef: BLACK_REF }, { room: ROOM.game(GAME_REF) }], event: "test:echo", data: { text: "hi" } };

  it("accepts the B20 targets[] shape only", () => {
    assert.equal(EmitBody.safeParse(emit).success, true);
    assert.equal(EmitBody.safeParse({ ...emit, dedupeKey: "k1" }).success, true);
    const rest = mutate(emit, "targets", undefined);
    assert.equal(EmitBody.safeParse({ ...rest, room: ROOM.game(GAME_REF) }).success, false, "{room} body");
    assert.equal(EmitBody.safeParse({ ...rest, rooms: [ROOM.game(GAME_REF)] }).success, false, "rooms[] body");
    assert.equal(EmitBody.safeParse({ ...emit, extra: 1 }).success, false, "strict");
    assert.equal(EmitBody.safeParse({ ...emit, v: 2 }).success, false);
    assert.equal(EmitBody.safeParse({ ...emit, targets: [] }).success, false);
    assert.equal(EmitBody.safeParse({ ...emit, targets: Array(51).fill({ userRef: BLACK_REF }) }).success, false);
    assert.equal(EmitBody.safeParse({ ...emit, targets: [{ room: "g:abc" }] }).success, false);
    assert.equal(EmitBody.safeParse({ ...emit, targets: [{ room: ROOM.game(GAME_REF), userRef: BLACK_REF }] }).success, false);
    assert.equal(EmitBody.safeParse({ ...emit, event: "Test Echo" }).success, false);
  });

  it("broadcast, drain and the legacy tournament alias", () => {
    assert.equal(BroadcastBody.safeParse({ v: 1, type: "restart", inSeconds: 30 }).success, true);
    assert.equal(BroadcastBody.safeParse({ v: 1, type: "restart", inSeconds: 4 }).success, false);
    assert.equal(BroadcastBody.safeParse({ v: 1, type: "restart", inSeconds: 601 }).success, false);
    assert.equal(DrainBody.safeParse({ v: 1 }).success, true);
    assert.equal(DrainBody.safeParse({ v: 1, now: true }).success, false);
    assert.equal(TournamentEventBody.safeParse({ event: "player_joined", tournamentReferenceId: "abc", data: {} }).success, true);
    assert.equal(TournamentEventBody.safeParse({ event: "drop_tables", tournamentReferenceId: "abc" }).success, false);
  });
});

describe("limits", () => {
  it("pins the transport numbers of §7.4.1 and §7.4.8", () => {
    assert.equal(PROTOCOL_VERSION, 2);
    assert.equal(MAX_HTTP_BUFFER_BYTES, 16_384);
    assert.deepEqual(COMMAND_BUCKET, { burst: 20, perSecond: 10 });
  });
});
