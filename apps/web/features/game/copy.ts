// Every string of the game screen (P2 plan 4.3, 4.8). game-core's viewState returns codes and params; this module
// turns them into text. Rules (P1 lib/shell/copy.test.ts): Title Case on buttons, sentence case for toasts,
// statuses and descriptions, no emoji, uppercase only through CSS. Typographic apostrophes as in the boards.
// Deliberate differences from the mocks are listed in plan 4.8 (unrated header, resign copy without stakes,
// "Analyse game" instead of the coach CTA, disconnect copy without a paused clock, named insufficient material).

import type { BarView, ResultView, StatusCode, SubCode } from "@repo/game-core/client/viewState";
import type { Toast } from "@repo/game-core/client/reducer";
import type { GameState, Side } from "@repo/game-core/machine/types";
import { describeMaterial, selectionHint } from "@repo/game-core/rules/describe";
import { parsePlacement, peekChess, sanLine, splitMoves } from "@repo/game-core/rules/chess";
import type { Square } from "@repo/game-core/rules/chess";
import { GRACE_FLAPPING_MS, GRACE_MS } from "@repo/game-core/constants";

export const colorName = (side: Side): string => (side === "w" ? "White" : "Black");
const other = (side: Side): Side => (side === "w" ? "b" : "w");

/** Who is who, from the viewer's seat. Spectators sit as White. */
export interface CopyCtx {
  me: Side;
  spectator: boolean;
  bot: boolean;
  /** Display names by colour. */
  names: { w: string; b: string };
}

export function copyCtx(state: GameState): CopyCtx {
  const spectator = state.you.role !== "player";
  return {
    me: !spectator && state.you.color ? state.you.color : "w",
    spectator,
    bot: state.mode === "BOT",
    names: { w: state.players.w.displayName, b: state.players.b.displayName },
  };
}

const oppName = (c: CopyCtx) => c.names[other(c.me)];

// ── buttons and labels (Title Case) ──

export const BUTTONS = {
  offerDraw: "Offer Draw",
  offerSent: "Offer Sent",
  hint: "Hint",
  undo: "Undo",
  abort: "Abort Game",
  abortShort: "Abort",
  flip: "Flip Board",
  flipShort: "Flip",
  movesLocked: "Moves Locked",
  more: "More",
  back: "Back",
  result: "Result",
  next: "Next",
  previousMove: "Previous Move",
  nextMove: "Next Move",
  /** The ⋯ button names the items its menu really has (a spectator's has no Resign: D9). */
  moreActions: (items: readonly string[]) => `More: ${items.join(", ")}`,
  resignItem: "Resign…",
  abortItem: "Abort Game",
  sound: (on: boolean) => `Sound · ${on ? "On" : "Off"}`,
  soundItem: "Sound",
  /** The move list's windowed slice past 200 plies (plan 4.6.3). */
  earlierMoves: "Show Earlier Moves",
  keepPlaying: "Keep Playing",
  resign: "Resign",
  decline: "Decline",
  accept: "Accept",
  cancel: "Cancel",
  copy: "Copy",
  copied: "Copied",
  cancelChallenge: "Cancel Challenge",
  ready: "I’m Ready · Start When Both Are",
  backToLive: "Back to Live",
  reloadGame: "Reload Game",
  analyse: "Analyse Game",
  backToPlay: "Back to Play",
  rematch: "Rematch",
  rematchBot: (side: Side) => `Rematch · as ${colorName(side)}`,
  restart: "Restart",
  newGame: "New Game",
  watchAnother: "Watch Another Game",
  backToTournament: "Back to Tournament",
  share: "Share or Download This Game",
  copyLink: "Copy Link",
  linkCopied: "Link Copied",
  downloadPgn: "Download PGN",
  moves: "Moves",
  tryAgain: "Try Again",
  useThisTab: "Use This Tab",
} as const;

// ── header ──

export function headerRight(state: GameState, spectator: boolean): string {
  if (spectator) {
    const tc = state.tc ? state.tc.label : "untimed";
    const cls = state.timeClass === "untimed" ? "" : `${state.timeClass[0]!.toUpperCase()}${state.timeClass.slice(1)} `;
    return `Watching · ${cls}${tc}`.trim();
  }
  return state.header.right;
}

// ── player bars ──

export function subText(bar: BarView, c: CopyCtx): string {
  const material = bar.material > 0 ? `+${bar.material} material` : "";
  switch (bar.state) {
    case "skel":
      return "";
    case "thinking":
      return "Thinking";
    case "waiting":
      return "Not joined yet";
    case "disconnected":
      return "Disconnected";
    case "reconnecting":
      return "Reconnecting…";
    case "ready":
      return "Ready";
    default:
      break;
  }
  const sub = bar.sub ? SUB_TEXT[bar.sub](c, bar.side) : "";
  if (sub && material && (bar.sub === "your_move" || bar.sub === null)) return `${sub} · ${material}`;
  return sub || material;
}

const SUB_TEXT: Record<SubCode, (c: CopyCtx, side: Side) => string> = {
  your_move: () => "Your move",
  your_move_clock_not_started: () => "Your move · clock not started",
  clock_not_started: () => "Clock not started",
  clock_starts_after_your_move: () => "Clock starts after your move",
  study_locked: () => "Study · moves locked",
  study: () => "Study",
  rematch_study_locked: (_c, side) => `${colorName(side)} · moves locked`,
  rematch_study: (_c, side) => `${colorName(side)} · study`,
  premove_queued: () => "Premove queued",
  check: () => "Check",
  promote: () => "Promote",
  low_time: () => "Low time",
  not_joined: () => "Not joined yet",
  disconnected: () => "Disconnected",
  ready: () => "Ready",
  thinking: () => "Thinking",
};

// ── status line ──

const PIECE_NAMES = { k: "King", q: "Queen", r: "Rook", b: "Bishop", n: "Knight", p: "Pawn" } as const;

export function statusText(
  status: { code: StatusCode; params?: Record<string, string | number> },
  c: CopyCtx,
  state: GameState,
): string {
  const p = status.params ?? {};
  switch (status.code) {
    case "selection_hint": {
      const sq = String(p.square) as Square;
      const chess = peekChess(state.fen, []);
      const hint = selectionHint(chess, sq);
      if (hint) return hint;
      const piece = chess.get(sq);
      return piece ? `${PIECE_NAMES[piece.type]} selected` : "";
    }
    case "first_move_note":
      return "Clocks start once both sides have made a first move.";
    case "rematch_your_note":
      return `Your first move as ${colorName(c.me)} starts both clocks.`;
    case "check":
      return "Check · block, capture or move the king";
    case "choose_piece":
      return "Choose a piece · Esc puts the pawn back";
    case "promotion_cancelled":
      return `Promotion cancelled · the pawn is back on ${String(p.square)}`;
    case "hint":
      // game-core's hintView text already reads "Hint n of 2: …".
      return /^Hint \d of 2:/.test(String(p.text)) ? String(p.text) : `Hint ${String(p.level)} of 2: ${String(p.text)}`;
  }
}

/** Status lines drawn in red (check, illegal), as in the template (`statusC`). */
export const STATUS_ALERT: ReadonlySet<StatusCode> = new Set<StatusCode>(["check"]);

// ── toasts (sentence case) ──

function movesWord(n: number): string {
  return n === 1 ? "1 move" : `${n} moves`;
}

/** Own moves until the draw cooldown ends (plies → the player's moves). */
export function movesUntil(canOfferAtPly: number, absPly: number): number {
  return Math.max(1, Math.ceil((canOfferAtPly - absPly) / 2));
}

/**
 * "Rxd7" for a premove (the move is not legal yet, so this is the piece letter, an x for a capture and the square).
 * A king going two files is castling: "O-O" / "O-O-O", as the move list writes it (it read "Kg1": dev recheck
 * 2026-11-12).
 */
export function premoveLabel(fen: string, uci: string): string {
  const board = parsePlacement(fen);
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const piece = board.get(from);
  const capture = board.has(to);
  if (!piece) return to;
  if (piece.type === "k" && from[1] === to[1] && Math.abs(to.charCodeAt(0) - from.charCodeAt(0)) === 2)
    return to[0]! > from[0]! ? "O-O" : "O-O-O";
  if (piece.type === "p") return capture ? `${from[0]}x${to}` : to;
  return `${piece.type.toUpperCase()}${capture ? "x" : ""}${to}`;
}

/** `offsetMs` = serverNow − Date.now() (toasts are stamped with the client clock). */
export function toastText(t: Toast, c: CopyCtx, state: GameState, absPly: number, offsetMs = 0): string {
  const p = t.params ?? {};
  switch (t.code) {
    case "illegal":
      return typeof p.text === "string" && p.text ? p.text : "That move isn’t legal. The piece went back.";
    case "rejected":
      return "Move not accepted. The board is back in sync with the server.";
    case "premove_set":
      return `Premove set: ${premoveLabel(state.fen, String(p.uci ?? ""))}. Right-click or Esc to cancel.`;
    case "premove_cancelled":
      return "Premove cancelled.";
    case "draw_declined_self":
      return "You declined the draw.";
    case "draw_declined":
      return `${oppName(c)} declined the draw. You can offer again in ${movesWord(movesUntil(Number(p.canOfferAtPly ?? 0), absPly))}.`;
    case "draw_cooldown":
      return `You can offer again in ${movesWord(movesUntil(Number(p.canOfferAtPly ?? 0), absPly))}.`;
    case "rematch_declined":
      return `${oppName(c)} declined the rematch.`;
    case "rematch_expired":
      return p.reason === "left" ? `Rematch offer expired: ${oppName(c)} left.` : "Rematch offer expired.";
    case "rematch_accepted":
      return `${oppName(c)} accepted. Colours swapped: you play ${colorName(c.me)}.`;
    case "rematch_paywall":
      return `${oppName(c)} can’t play a rematch right now.`;
    case "opp_disconnected": {
      const secs = graceSecondsOf(typeof p.graceEndsAt === "number" ? p.graceEndsAt : null, t.at + offsetMs);
      return `${oppName(c)} disconnected. They have ${secs} seconds to reconnect.`;
    }
    case "opp_reconnected":
      return `${oppName(c)} reconnected.`;
    case "reconnected":
      return p.san ? `Back online. ${String(p.san)} was sent.` : "Back online.";
    case "outbox_full":
      return "One move is already queued.";
    case "server_error":
      return "Something went wrong on the game server.";
    case "rate_limited":
      return "Slow down a little.";
    case "draining":
      return "The server is restarting. Try again in a minute.";
    case "took_back":
      return typeof p.text === "string" && p.text ? p.text : "Took back your last move.";
    case "engine_declined_draw":
      return "The engine declined the draw.";
    case "hint":
      return typeof p.text === "string" ? p.text : "";
    case "already_ended":
      return "This game has already ended.";
    case "study_reconnect":
      return "Reconnecting… the study timer keeps running.";
  }
}

/** Grace seconds the toast names: 30, or 10 for a player who dropped three times in two minutes (plan 8.6). */
export function graceSecondsOf(graceEndsAt: number | null | undefined, serverNow: number): number {
  if (!graceEndsAt) return GRACE_MS / 1000;
  const left = graceEndsAt - serverNow;
  return left <= GRACE_FLAPPING_MS + 1_000 ? GRACE_FLAPPING_MS / 1000 : GRACE_MS / 1000;
}

// ── zones ──

export const ZONE = {
  loading: "Loading game",
  waitingLabel: "Waiting for opponent",
  waitingBody: (study: boolean) =>
    study
      ? "Send this link. The game starts with a 30 s study phase when they join."
      : "Send this link. The game starts when they join.",
  challengeLink: "Challenge link",
  studyLabel: "Study the position",
  rematchStudyLabel: (c: CopyCtx) => `Rematch · study as ${colorName(c.me)}`,
  studyBody:
    "Moves are locked. Draw arrows with right-drag to plan. Then each side gets 30 s for a first move; clocks start once both have moved.",
  waitingForOpp: (c: CopyCtx) => `Waiting for ${oppName(c)}…`,
  firstMoveMine: "Make your first move",
  firstMoveTheirs: (c: CopyCtx) => `${oppName(c)}’s first move`,
  abortNote: "No move by then and the game is aborted, unrated.",
  reconnecting: "Reconnecting…",
  reconnectWithin: (t: string) => `Reconnect within ${t}`,
  reconnectBody: (san: string | null, myClock: boolean) => {
    const clock = myClock ? "Your clock is running." : "";
    const queued = san ? `${san} is queued and will be sent when you’re back.` : "";
    return [clock, queued].filter(Boolean).join(" ");
  },
  restartLabel: "Server update",
  restartBody: "Back in a few seconds · clocks are paused",
  discLabel: "Opponent disconnected",
  discLine: (c: CopyCtx, t: string) => `${oppName(c)} has ${t} to return`,
  discBody: (oppToMove: boolean) =>
    oppToMove
      ? "If they don’t come back in time, you win. Their clock keeps running."
      : "Your clock is running. If they don’t come back, you win.",
  errorLabel: "Server error",
  errorTitle: "Lost sync with the game server",
  errorBody: "Your last move is safe. Reload to fetch the current position.",
  endedTitle: "This game has already ended",
  watching: (n: number) => `${n} watching`,
  spectBody: "Moves only · sound quiet",
  viewing: (label: string) => `Viewing ${label} · clock running`,
  engineError: "The engine couldn’t start on this device. This browser may block WebAssembly.",
  /** The engine files are still downloading (a slow network, a cold cache): not a failure. */
  engineLoading: (percent: number | null) => (percent === null ? "Loading the engine…" : `Loading the engine… ${percent}%`),
  otherTab: "This game is open in another tab",
  lockedAttempt: "Moves are locked during the study phase",
} as const;

// ── offer bars ──

export const BARS = {
  drawOffer: (c: CopyCtx) => ({ who: oppName(c), rest: " offers a draw" }),
  rematchIn: (c: CopyCtx) => ({ who: oppName(c), rest: ` wants a rematch · you’d play ${colorName(other(c.me))}` }),
  rematchOut: (c: CopyCtx) => `Rematch offered · colours swap, you’ll play ${colorName(other(c.me))}`,
};

// ── resign ──

export function resignBody(c: CopyCtx): string {
  return c.bot ? "Resign this game? The engine wins." : `Resign this game? ${oppName(c)} wins.`;
}
export const RESIGN_TITLE = "Resign this game?";

// ── result card ──

export const KIND_LABEL: Record<ResultView["kind"], string> = {
  win: "Victory",
  loss: "Defeat",
  draw: "Draw",
  neutral: "Result",
};

export interface ResultCopy {
  kindLabel: string;
  title: string;
  method: string;
}

/** The side whose clock ran out at the end (timeout methods). */
function flaggedSide(state: GameState): Side {
  const { w, b } = state.clocks;
  if (w <= 0 && b > 0) return "w";
  if (b <= 0 && w > 0) return "b";
  return state.turn;
}

function lastSan(state: GameState): string {
  const moves = splitMoves(state.moves);
  if (!moves.length) return "";
  const sans = sanLine(state.startFen, moves);
  const n = state.startPly + moves.length; // absolute ply of the last move
  const no = Math.floor((n - 1) / 2) + 1;
  return `${no}${n % 2 === 1 ? "." : "…"}${sans[sans.length - 1] ?? ""}`;
}

export function resultCopy(r: ResultView, c: CopyCtx, state: GameState): ResultCopy {
  const move = `move ${r.moveNo}`;
  const opp = oppName(c);
  if (r.spectator) {
    const vs = `${c.names.w} vs ${c.names.b}`;
    const last = lastSan(state);
    const method = last ? `${vs} · ${last}` : vs;
    return { kindLabel: "Spectating · result", title: spectatorTitle(r, c), method };
  }
  const kindLabel = KIND_LABEL[r.kind];
  const won = r.kind === "win";
  switch (r.method) {
    case "checkmate":
      return { kindLabel, title: won ? "You won by checkmate" : `${opp} won by checkmate`, method: `Checkmate · ${move}` };
    case "resignation":
      return { kindLabel, title: won ? `${opp} resigned` : "You resigned", method: `Resignation · ${move}` };
    case "timeout":
      return won
        ? { kindLabel, title: "You won on time", method: `${opp} ran out of time · ${move}` }
        : { kindLabel, title: "You lost on time", method: `Your clock ran out · ${move}` };
    case "timeout_vs_insufficient":
      return {
        kindLabel,
        title: "Draw · timeout vs insufficient material",
        method: flaggedSide(state) === c.me ? `Your clock ran out · ${move}` : `${opp} ran out of time · ${move}`,
      };
    case "stalemate":
      return { kindLabel, title: "Draw by stalemate", method: `Stalemate · ${move}` };
    case "threefold":
      return { kindLabel, title: "Draw by repetition", method: `Threefold repetition · ${move}` };
    case "fifty_move":
      return { kindLabel, title: "Draw by 50-move rule", method: `50 moves without a capture or pawn move · ${move}` };
    case "insufficient_material":
      return { kindLabel, title: "Draw · insufficient material", method: `${describeMaterial(state.fen)} · ${move}` };
    case "agreement":
      return { kindLabel, title: "Draw agreed", method: `Draw by agreement · ${move}` };
    case "abandoned":
      return won
        ? { kindLabel, title: `You won · ${opp} left the game`, method: "Opponent did not reconnect within 30 s" }
        : { kindLabel, title: "You left the game", method: "You did not reconnect within 30 s" };
    case "aborted": {
      const why =
        r.abortedBy === "you"
          ? "You aborted the game"
          : r.abortedBy === "opponent"
            ? `Aborted by ${opp}`
            : "No first move within 30 s";
      return { kindLabel, title: "Game aborted", method: `${why} · not rated` };
    }
  }
}

function spectatorTitle(r: ResultView, c: CopyCtx): string {
  const w = r.winner ? colorName(r.winner) : null;
  switch (r.method) {
    case "checkmate":
      return `${w} wins by checkmate`;
    case "resignation":
      return `${w} wins by resignation`;
    case "timeout":
      return `${w} wins on time`;
    case "abandoned":
      return `${w} wins · ${r.winner ? c.names[other(r.winner)] : ""} left`;
    case "aborted":
      return "Game aborted";
    case "timeout_vs_insufficient":
      return "Draw · timeout vs insufficient material";
    case "stalemate":
      return "Draw by stalemate";
    case "threefold":
      return "Draw by repetition";
    case "fifty_move":
      return "Draw by 50-move rule";
    case "insufficient_material":
      return "Draw · insufficient material";
    case "agreement":
      return "Draw agreed";
  }
}

/** The `already_ended` zone line: "knightowl_88 won by checkmate on move 17." */
export function alreadyEndedLine(r: ResultView | null, c: CopyCtx): string {
  if (!r) return "";
  const on = `on move ${r.moveNo}`;
  if (r.method === "aborted") return "The game was aborted before both sides moved.";
  if (!r.winner) {
    const how: Record<string, string> = {
      stalemate: "stalemate",
      threefold: "repetition",
      fifty_move: "the 50-move rule",
      insufficient_material: "insufficient material",
      agreement: "agreement",
      timeout_vs_insufficient: "timeout vs insufficient material",
    };
    return `Drawn by ${how[r.method] ?? "agreement"} ${on}.`;
  }
  const name = c.names[r.winner];
  const how: Record<string, string> = {
    checkmate: "by checkmate",
    resignation: "by resignation",
    timeout: "on time",
    abandoned: "after the opponent left",
  };
  return `${name} won ${how[r.method] ?? ""} ${on}.`.replace(/\s+/g, " ");
}

// ── chips (V3SessionExpired in-game variants, V3Maintenance in_game) ──

export const CHIPS = {
  restarting: (t: string) => `Server restarting in ${t} · Games in progress will resume. Keep playing.`,
  /** The restart time has come (or the drain was not announced in advance): no countdown. */
  restartingNow: "Server restarting · Games in progress will resume.",
  authRefreshing: (t: string) => `Auth… refreshing sign-in · retry in ${t}`,
  authOk: "Signed in · game continues",
  upgrade: "Update ready · installs after this game",
} as const;

// ── board ──

export function boardLabel(c: CopyCtx): string {
  return c.spectator ? "Board. You are watching." : `Board. You are ${colorName(c.me)}.`;
}

/** "11.Bxb5+" for a viewed absolute ply. */
export function plyLabel(state: GameState, absPly: number, sans: readonly string[]): string {
  const idx = absPly - state.startPly - 1;
  const san = sans[idx];
  if (!san) return "start";
  const no = Math.floor((absPly - 1) / 2) + 1;
  return `${no}${absPly % 2 === 1 ? "." : "…"}${san}`;
}
