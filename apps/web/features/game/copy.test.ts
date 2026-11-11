// copy.ts: the per-state strings of plan 4.3/4.8 and P1's copy rules (Title Case buttons, sentence-case toasts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { TOAST_KIND, absPly, type ToastCode } from "@repo/game-core/client/reducer";
import { LIT_STATES, type ResultView } from "@repo/game-core/client/viewState";
import { END_METHODS, type GameState } from "@repo/game-core/machine/types";
import { replayTranscript } from "@repo/game-core/testing/harness";
import { buildTranscript } from "@repo/game-core/testing/scenarios";
import {
  alreadyEndedLine,
  BUTTONS,
  copyCtx,
  headerRight,
  movesUntil,
  premoveLabel,
  resultCopy,
  statusText,
  subText,
  toastText,
} from "./copy";

const MINOR = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "at", "as"]);
function isTitleCase(text: string): boolean {
  const words = text.split(/[\s·:]+/).filter((w) => /\p{L}/u.test(w));
  return words.every((w, i) => {
    const letters = w.replace(/^[^\p{L}]+/u, "");
    if (i > 0 && MINOR.has(letters)) return true;
    return /^\p{Lu}/u.test(letters) || letters === "PGN";
  });
}

const state: GameState = replayTranscript(buildTranscript("your_move")).store.state;
const ctx = copyCtx(state); // White = knightowl_88, Black = martin_k; viewer White

test("every button label is Title Case", () => {
  for (const [key, value] of Object.entries(BUTTONS)) {
    const texts =
      key === "moreActions"
        ? [BUTTONS.moreActions([BUTTONS.resign, BUTTONS.flip, BUTTONS.soundItem])]
        : typeof value === "function"
          ? [value(true as never), value("b" as never)]
          : [value];
    for (const t of texts) assert.ok(isTitleCase(String(t)), `${key}: "${t}"`);
  }
});

test("every toast is sentence case, never empty, and has a kind", () => {
  for (const code of Object.keys(TOAST_KIND) as ToastCode[]) {
    const text = toastText(
      { code, kind: TOAST_KIND[code], at: 0, params: { text: "Hint 1 of 2: look at your king.", uci: "d1d7", canOfferAtPly: absPly(state) + 4 } },
      ctx,
      state,
      absPly(state),
    );
    assert.ok(text.length > 0, code);
    assert.match(text, /^\p{Lu}|^[a-z0-9_]+ /u, `${code}: "${text}"`);
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}]/u, `${code} has an emoji`);
  }
});

test("design copy of the toast-led states (plan 4.3)", () => {
  const t = (code: ToastCode, params?: Record<string, string | number>) =>
    toastText({ code, kind: TOAST_KIND[code], at: 0, params }, ctx, state, 20);
  assert.equal(t("rejected"), "Move not accepted. The board is back in sync with the server.");
  assert.equal(t("premove_cancelled"), "Premove cancelled.");
  assert.equal(t("draw_declined", { canOfferAtPly: 24 }), "martin_k declined the draw. You can offer again in 2 moves.");
  assert.equal(t("opp_disconnected"), "martin_k disconnected. They have 30 seconds to reconnect.");
  assert.equal(t("opp_reconnected"), "martin_k reconnected.");
  assert.equal(t("reconnected", { san: "Bxd7+" }), "Back online. Bxd7+ was sent.");
  assert.equal(t("reconnected"), "Back online.");
  assert.equal(t("rematch_declined"), "martin_k declined the rematch.");
  assert.equal(t("rematch_expired", { reason: "left" }), "Rematch offer expired: martin_k left.");
  assert.equal(t("rematch_expired", { reason: "timeout" }), "Rematch offer expired.");
  assert.equal(t("server_error"), "Something went wrong on the game server.");
  assert.equal(t("already_ended"), "This game has already ended.");
  assert.equal(t("study_reconnect"), "Reconnecting… the study timer keeps running.");
});

test("status lines", () => {
  assert.equal(statusText({ code: "check" }, ctx, state), "Check · block, capture or move the king");
  assert.equal(statusText({ code: "choose_piece" }, ctx, state), "Choose a piece · Esc puts the pawn back");
  assert.equal(statusText({ code: "first_move_note" }, ctx, state), "Clocks start once both sides have made a first move.");
  // regression: game-core's hintView text already carries "Hint n of 2:" (status line read "Hint 2 of 2: Hint 2 of 2: …").
  assert.equal(statusText({ code: "hint", params: { level: 2, text: "Hint 2 of 2: play exd5." } }, ctx, state), "Hint 2 of 2: play exd5.");
  assert.equal(
    statusText({ code: "promotion_cancelled", params: { square: "b7" } }, ctx, state),
    "Promotion cancelled · the pawn is back on b7",
  );
});

test("player-bar sub lines carry the material when ahead", () => {
  const bar = { side: "w" as const, state: "" as const, sub: "your_move" as const, material: 4, tag: null, online: true };
  assert.equal(subText(bar, ctx), "Your move · +4 material");
  assert.equal(subText({ ...bar, sub: null }, ctx), "+4 material");
  assert.equal(subText({ ...bar, state: "thinking" }, ctx), "Thinking");
  assert.equal(subText({ ...bar, state: "waiting" }, ctx), "Not joined yet");
});

test("every end method has a result title and method line, for players and spectators", () => {
  for (const method of END_METHODS) {
    for (const kind of ["win", "loss", "draw", "neutral"] as const) {
      const r: ResultView = { kind, method, winner: kind === "draw" ? null : "w", ply: 33, moveNo: 17, abortedBy: null, spectator: false };
      const c = resultCopy(r, ctx, state);
      assert.ok(c.title && c.method && c.kindLabel, `${method}/${kind}`);
      const s = resultCopy({ ...r, spectator: true }, ctx, state);
      assert.ok(s.title && s.method, `spectator ${method}`);
    }
  }
  const win = resultCopy({ kind: "win", method: "checkmate", winner: "w", ply: 33, moveNo: 17, abortedBy: null, spectator: false }, ctx, state);
  assert.deepEqual(win, { kindLabel: "Victory", title: "You won by checkmate", method: "Checkmate · move 17" });
  const aborted = resultCopy({ kind: "neutral", method: "aborted", winner: null, ply: 0, moveNo: 1, abortedBy: "opponent", spectator: false }, ctx, state);
  assert.equal(aborted.method, "Aborted by martin_k · not rated");
});

test("already-ended line names the winner and the move", () => {
  const r: ResultView = { kind: "win", method: "checkmate", winner: "w", ply: 33, moveNo: 17, abortedBy: null, spectator: false };
  assert.equal(alreadyEndedLine(r, ctx), "knightowl_88 won by checkmate on move 17.");
});

test("helpers: premove label, draw cooldown in own moves, spectator header", () => {
  assert.equal(premoveLabel("4k3/3r4/8/8/8/8/8/3QK3 w - - 0 1", "d1d7"), "Qxd7");
  assert.equal(premoveLabel("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", "e2e4"), "e4");
  assert.equal(movesUntil(24, 20), 2);
  assert.equal(movesUntil(21, 20), 1);
  assert.match(headerRight(state, true), /^Watching · /);
});

test("all 50 lit states are covered by the copy tables (no state renders without text)", () => {
  assert.equal(LIT_STATES.length, 50);
});
