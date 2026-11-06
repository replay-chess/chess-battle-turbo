// The 55 states (plan 4.3): every lit state is reached by a real-protocol scenario (server machine → events →
// client reducer), its transcript replays to the same view after a JSON round trip, and the zone / actions /
// bar / toast match the plan's state table. Golden transcripts under @repo/chess-fixtures/socket/transcripts
// (WP-C) are replayed too when present.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { reduceClient } from "../src/client/reducer";
import { DESIGN_STATES, LIT_STATES, UNLIT_STATES, deriveViewState } from "../src/client/viewState";
import { replayTranscript, type ClientTranscript } from "../src/testing/harness";
import { replayGolden, type GoldenExpectation, type GoldenRole, type GoldenTranscript } from "../src/testing/golden";
import { SCENARIOS, buildTranscript } from "../src/testing/scenarios";

test("55 design states; 5 not lit in P2", () => {
  assert.equal(DESIGN_STATES.length, 55);
  assert.equal(new Set(DESIGN_STATES).size, 55);
  assert.deepEqual([...UNLIT_STATES].sort(), [
    "over_analysing",
    "over_guest",
    "over_legend",
    "over_tournament",
    "tournament",
  ]);
  assert.equal(LIT_STATES.length, 50);
  for (const s of LIT_STATES) assert.ok(SCENARIOS[s], `scenario for ${s}`);
});

// Plan 4.3 columns: zone · actions · offer bar · toast code (null = no toast).
const TABLE: Record<string, [string, string, string | null, string | null]> = {
  loading: ["loading", "disabled", null, null],
  waiting: ["waiting", "waiting", null, null],
  study: ["study", "study", null, null],
  study_last5: ["study", "study", null, null],
  study_reconnect: ["study", "study", null, "study_reconnect"],
  abort: ["abort", "abort", null, null],
  rematch_study: ["study", "study", null, "rematch_accepted"],
  rematch_first: ["abort", "disabled", null, null],
  rematch_your: ["abort", "abort", null, null],
  your_move: ["", "online", null, null],
  their_move: ["", "online", null, null],
  premove: ["", "online", null, "premove_set"],
  premove_cancelled: ["", "online", null, "premove_cancelled"],
  check: ["", "online", null, null],
  illegal: ["", "online", null, "illegal"],
  promotion: ["", "online", null, null],
  rejected: ["", "online", null, "rejected"],
  low_time: ["", "online", null, null],
  viewing: ["viewing", "online", null, null],
  draw_sent: ["", "online", null, null],
  draw_received: ["", "online", "draw", null],
  draw_declined: ["", "online", null, "draw_declined"],
  resign_confirm: ["", "online", null, null],
  reconnecting: ["reconnect", "online", null, null],
  reconnected: ["", "online", null, "reconnected"],
  opp_disconnected: ["disc", "online", null, "opp_disconnected"],
  opp_reconnected: ["", "online", null, "opp_reconnected"],
  bot: ["coach", "bot", null, null],
  already_ended: ["ended", "none", null, "already_ended"],
  server_error: ["error", "online", null, "server_error"],
  spectate: ["spect", "spect", null, null],
  over_spectator: ["result", "over", null, null],
  over_rematch_sent: ["result", "over", "rematch_out", null],
  over_rematch_received: ["result", "over", "rematch_in", null],
  over_rematch_declined: ["result", "over", null, "rematch_declined"],
  over_rematch_expired: ["result", "over", null, "rematch_expired"],
};

for (const state of LIT_STATES) {
  test(`state ${state}: reached from real protocol traffic and replayed from its transcript`, () => {
    const t = buildTranscript(state);
    assert.equal(t.expect.primary, state, `primary for ${state}`);
    const json = JSON.parse(JSON.stringify(t)) as ClientTranscript;
    const { view } = replayTranscript(json);
    assert.equal(view.primary, state);
    assert.equal(view.zone, t.expect.zone);
    assert.equal(view.actions, t.expect.actions);
    const row = TABLE[state] ?? (state.startsWith("over_") ? ["result", "over", null, null] : null);
    if (row) {
      assert.deepEqual([view.zone, view.actions, view.bar, view.toast?.code ?? null], row, `${state} table row`);
    }
  });
}

test("result view and badges: checkmate win/loss, resignation flag, draws on both kings", () => {
  const win = replayTranscript(buildTranscript("over_checkmate_win")).view;
  assert.equal(win.result?.kind, "win");
  assert.equal(win.result?.moveNo, 17);
  assert.deepEqual(win.board.badges.map((b) => [b.square, b.kind]).sort(), [
    ["c1", "win"],
    ["e8", "mate"],
  ]);
  assert.deepEqual([win.bars.me.tag, win.bars.opp.tag], ["WON", "LOST"]);
  const resign = replayTranscript(buildTranscript("over_resign_win")).view;
  assert.deepEqual(resign.board.badges, [{ square: "e8", kind: "flag" }]);
  const stale = replayTranscript(buildTranscript("over_stalemate")).view;
  assert.deepEqual(
    stale.board.badges.map((b) => b.kind),
    ["draw", "draw"],
  );
  assert.equal(stale.result?.moveNo, 58);
  const aborted = replayTranscript(buildTranscript("over_aborted")).view;
  assert.deepEqual(
    [aborted.result?.kind, aborted.result?.abortedBy, aborted.board.badges.length],
    ["neutral", "timeout", 0],
  );
  const spect = replayTranscript(buildTranscript("over_spectator")).view;
  assert.equal(spect.result?.kind, "neutral");
});

test("modifiers combine: check + premove, low_time + viewing", () => {
  const check = buildTranscript("check");
  assert.ok(replayTranscript(check).view.modifiers.has("check"));
  const low = buildTranscript("low_time");
  const { store } = replayTranscript(low);
  const viewing = { ...store, view: store.state.startPly + 1 };
  const { deriveViewState } = require("../src/client/viewState") as typeof import("../src/client/viewState");
  const v = deriveViewState(viewing, low.t0 + low.serverNow);
  assert.ok(v.modifiers.has("low_time") && v.modifiers.has("viewing"));
  assert.equal(v.primary, "viewing");
});

test("countdowns, ghosts and board input per state", () => {
  const study = replayTranscript(buildTranscript("study")).view;
  assert.equal(study.countdown?.kind, "study");
  assert.equal(study.board.input, "none");
  const abort = replayTranscript(buildTranscript("abort")).view;
  assert.equal(abort.countdown?.kind, "first_move");
  assert.equal(abort.board.input, "move");
  assert.equal(abort.status?.code, "first_move_note");
  const disc = replayTranscript(buildTranscript("opp_disconnected")).view;
  assert.equal(disc.countdown?.kind, "grace");
  assert.equal(disc.bars.opp.state, "disconnected");
  const rec = replayTranscript(buildTranscript("reconnecting")).view;
  assert.equal(rec.board.ghost?.kind, "outbox");
  assert.equal(rec.bars.me.state, "reconnecting");
  const pre = replayTranscript(buildTranscript("premove")).view;
  assert.equal(pre.board.ghost?.kind, "premove");
  assert.equal(pre.bars.me.sub, "premove_queued");
  const their = replayTranscript(buildTranscript("their_move")).view;
  assert.equal(their.board.input, "premove");
  assert.equal(their.bars.opp.state, "thinking");
  const waiting = replayTranscript(buildTranscript("waiting")).view;
  assert.ok(waiting.board.dimmed);
  assert.equal(waiting.bars.opp.sub, "not_joined");
  const received = replayTranscript(buildTranscript("over_rematch_received")).view;
  assert.equal(received.countdown?.kind, "rematch");
  const promo = replayTranscript(buildTranscript("promotion")).view;
  assert.equal(promo.status?.code, "choose_piece");
});

// regression (WP-H): a bot game kept board input while another tab owned it or the engine had failed.
test("bot games: no board input while another tab owns the game or the engine failed", () => {
  const t = buildTranscript("bot");
  const { store, view } = replayTranscript(t);
  const now = t.t0 + t.serverNow;
  const patched = (patch: { otherTab?: boolean; engineError?: boolean }) =>
    deriveViewState(reduceClient(store, { type: "bot", patch }).store, now).board.input;
  assert.equal(patched({}), view.board.input);
  assert.equal(patched({ otherTab: true }), "none");
  assert.equal(patched({ engineError: true }), "none");
});

const require = createRequire(import.meta.url);
function goldenDir(): string | null {
  try {
    const dir = path.join(path.dirname(require.resolve("@repo/chess-fixtures/README.md")), "socket", "transcripts");
    return existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

/**
 * Where WP-B's reducer deliberately differs from a skeleton expectation (each one is a request to WP-C to update
 * the file): role → the expectation WP-B asserts instead.
 */

const golden = goldenDir();
const goldenFiles = golden ? readdirSync(golden).filter((f) => f.endsWith(".json")) : [];
if (goldenFiles.length === 0) test.skip("golden transcripts (@repo/chess-fixtures/socket/transcripts, WP-C): none yet");
for (const f of goldenFiles) {
  test(`golden transcript ${f}`, () => {
    const tr = JSON.parse(readFileSync(path.join(golden!, f), "utf8")) as GoldenTranscript;
    for (const [role, exp] of Object.entries(tr.expect) as [GoldenRole, GoldenExpectation][]) {
      const { view } = replayGolden(tr, role);
      assert.ok(view, `${role}: no store`);
      const at = `${tr.state} as ${role}`;
      assert.equal(view.primary, exp.primary, `${at}: primary`);
      if (exp.zone) assert.equal(view.zone, exp.zone, `${at}: zone`);
      if (exp.actions) assert.equal(view.actions, exp.actions, `${at}: actions`);
      for (const m of exp.modifiers ?? []) assert.ok(view.modifiers.has(m as never), `${at}: modifier ${m}`);
      if (exp.toast)
        assert.ok(
          view.toast && exp.toast.startsWith(view.toast.code),
          `${at}: toast ${exp.toast} vs ${view.toast?.code}`,
        );
    }
  });
}

test("regression: FIX-A — the player who accepted the rematch gets no 'X accepted' toast; no hint in the status line", () => {
  const t = buildTranscript("rematch_study");
  const { store, view } = replayTranscript(JSON.parse(JSON.stringify(t)) as ClientTranscript);
  assert.equal(view.toast?.code, "rematch_accepted");
  const accepter = deriveViewState({ ...store, acceptedRematch: true }, t.t0 + t.serverNow);
  assert.equal(accepter.toast, null);
  const bot = buildTranscript("bot");
  const botView = replayTranscript(JSON.parse(JSON.stringify(bot)) as ClientTranscript);
  const hinted = deriveViewState(
    reduceClient(botView.store, { type: "bot", patch: { hint: { level: 1, text: "Hint 1 of 2: look at your king.", arrow: null } } }).store,
    bot.t0 + bot.serverNow,
  );
  assert.notEqual(hinted.status?.code, "hint");
});
