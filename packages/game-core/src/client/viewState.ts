// The 55 V3Game states (plan 4.3) derived from the client store: deriveViewState(store, serverNow) → the primary
// design state (exposed as data-phase), combinable modifiers, the zone (precedence result > error > reconnect >
// disc > viewing > waiting > study > abort > spect > coach > none), the action variant, the offer bar, the toast,
// the status line, the player bars, the running countdown and the board marks. Copy is NOT produced here: codes
// and params go to WEB/features/game/copy.ts.

import { remaining } from "../clock/clock";
import { LOW_TIME_MS, STUDY_LAST_MS } from "../constants";
import { Chess, splitMoves, parseUci } from "../rules/chess";
import { materialOf } from "../rules/material";
import type { EndMethod, GameState, Side } from "../machine/types";
import { otherSide } from "../machine/types";
import type { ClientGame, Toast } from "./reducer";

export const DESIGN_STATES = [
  "loading",
  "waiting",
  "study",
  "study_last5",
  "study_reconnect",
  "abort",
  "rematch_study",
  "rematch_first",
  "rematch_your",
  "your_move",
  "their_move",
  "premove",
  "premove_cancelled",
  "check",
  "illegal",
  "promotion",
  "rejected",
  "low_time",
  "viewing",
  "draw_sent",
  "draw_received",
  "draw_declined",
  "resign_confirm",
  "reconnecting",
  "reconnected",
  "opp_disconnected",
  "opp_reconnected",
  "bot",
  "tournament",
  "already_ended",
  "server_error",
  "spectate",
  "over_checkmate_win",
  "over_checkmate_loss",
  "over_resign_win",
  "over_resign_loss",
  "over_timeout_win",
  "over_timeout_loss",
  "over_timeout_insufficient",
  "over_stalemate",
  "over_threefold",
  "over_fifty",
  "over_insufficient",
  "over_agreement",
  "over_abandoned",
  "over_aborted",
  "over_analysing",
  "over_legend",
  "over_tournament",
  "over_guest",
  "over_spectator",
  "over_rematch_sent",
  "over_rematch_received",
  "over_rematch_declined",
  "over_rematch_expired",
] as const;
export type DesignState = (typeof DESIGN_STATES)[number];

/** States P2 does not light (plan 4.3: P3, P12, dropped). */
export const UNLIT_STATES: readonly DesignState[] = [
  "tournament",
  "over_analysing",
  "over_legend",
  "over_tournament",
  "over_guest",
];
export const LIT_STATES: readonly DesignState[] = DESIGN_STATES.filter((s) => !UNLIT_STATES.includes(s));

export type Modifier =
  | "check"
  | "premove"
  | "low_time"
  | "viewing"
  | "promotion"
  | "draw_received"
  | "draw_sent"
  | "reconnecting"
  | "opp_disconnected"
  | "resign_confirm"
  | "restarting"
  | "frozen"
  | "study_last5"
  | "flash_back_to_live"
  | "outbox";

export type Zone =
  | ""
  | "loading"
  | "waiting"
  | "study"
  | "coach"
  | "viewing"
  | "reconnect"
  | "disc"
  | "abort"
  | "tour"
  | "error"
  | "ended"
  | "spect"
  | "result";

export type ActionsVariant = "online" | "bot" | "abort" | "spect" | "study" | "waiting" | "disabled" | "over" | "none";

export type BarState = "" | "skel" | "waiting" | "thinking" | "reconnecting" | "disconnected" | "ready";
export type SubCode =
  | "your_move"
  | "your_move_clock_not_started"
  | "clock_not_started"
  | "clock_starts_after_your_move"
  | "study_locked"
  | "study"
  | "rematch_study_locked"
  | "rematch_study"
  | "premove_queued"
  | "check"
  | "promote"
  | "low_time"
  | "not_joined"
  | "disconnected"
  | "ready"
  | "thinking";

export interface BarView {
  side: Side;
  state: BarState;
  sub: SubCode | null;
  /** "+N material" when this side is ahead, else 0. */
  material: number;
  tag: "WON" | "LOST" | "DRAW" | null;
  online: boolean;
}

export type StatusCode =
  | "selection_hint"
  | "first_move_note"
  | "rematch_your_note"
  | "check"
  | "choose_piece"
  | "promotion_cancelled"
  | "hint";

export type CountdownKind = "study" | "first_move" | "reconnect" | "grace" | "rematch";

export type BadgeKind = "mate" | "win" | "flag" | "draw";

export interface ResultView {
  kind: "win" | "loss" | "draw" | "neutral";
  method: EndMethod;
  winner: Side | null;
  ply: number;
  /** Fullmove number of the last ply (method lines read "move 17"). */
  moveNo: number;
  abortedBy: "you" | "opponent" | "timeout" | null;
  spectator: boolean;
}

export interface ViewState {
  primary: DesignState;
  modifiers: Set<Modifier>;
  zone: Zone;
  actions: ActionsVariant;
  bar: "draw" | "rematch_in" | "rematch_out" | null;
  toast: Toast | null;
  status: { code: StatusCode; params?: Record<string, string | number> } | null;
  bars: { me: BarView; opp: BarView };
  countdown: { kind: CountdownKind; endsAt: number } | null;
  /** The side whose clock runs (null when stopped). */
  tick: Side | null;
  result: ResultView | null;
  board: {
    /** FEN shown (the viewed ply while browsing history). */
    fen: string;
    orientation: Side;
    lastMove: [string, string] | null;
    checkSquare: string | null;
    dimmed: boolean;
    ghost: { from: string; to: string; kind: "outbox" | "premove" } | null;
    badges: { square: string; kind: BadgeKind }[];
    /** What a drag on the board does now. */
    input: "move" | "premove" | "none";
  };
  draw: { label: "offer" | "sent"; disabled: boolean };
}

const OVER_BY_METHOD: Record<EndMethod, (mine: "win" | "loss" | "draw") => DesignState> = {
  checkmate: (r) => (r === "win" ? "over_checkmate_win" : "over_checkmate_loss"),
  resignation: (r) => (r === "win" ? "over_resign_win" : "over_resign_loss"),
  timeout: (r) => (r === "win" ? "over_timeout_win" : "over_timeout_loss"),
  timeout_vs_insufficient: () => "over_timeout_insufficient",
  stalemate: () => "over_stalemate",
  threefold: () => "over_threefold",
  fifty_move: () => "over_fifty",
  insufficient_material: () => "over_insufficient",
  agreement: () => "over_agreement",
  abandoned: () => "over_abandoned",
  aborted: () => "over_aborted",
};

/** Viewer's colour (spectators see White at the bottom unless flipped). */
function seat(s: GameState): { me: Side; player: boolean } {
  if (s.you.role === "player" && s.you.color) return { me: s.you.color, player: true };
  return { me: "w", player: false };
}

function kingSquare(fen: string, side: Side): string | null {
  const c = new Chess(fen);
  return c.findPiece({ type: "k", color: side })[0] ?? null;
}

function fenAtPly(s: GameState, ply: number): string {
  const moves = splitMoves(s.moves).slice(0, ply);
  const c = new Chess(s.startFen);
  for (const m of moves) {
    const p = parseUci(m);
    if (!p) break;
    try {
      c.move(p.promotion ? { from: p.from, to: p.to, promotion: p.promotion } : { from: p.from, to: p.to });
    } catch {
      break;
    }
  }
  return c.fen();
}

/** "move 17": the fullmove number of an absolute ply (startPly + n). */
export function moveNoOfPly(absolutePly: number): number {
  return Math.floor((Math.max(1, absolutePly) - 1) / 2) + 1;
}

export function deriveViewState(g: ClientGame, serverNow: number): ViewState {
  const s = g.state;
  const { me, player } = seat(s);
  const opp = otherSide(me);
  const mods = new Set<Modifier>();
  const plies = splitMoves(s.moves).length;
  const connDown = g.conn === "reconnecting" || g.conn === "offline";
  const isBot = s.mode === "BOT";
  const myTurn =
    player && (s.phase === "first_move" ? s.firstMove?.side === me : s.phase === "playing" && s.turn === me);
  const toastCode = g.toast?.code ?? null;

  if (s.inCheck && s.phase !== "ended") mods.add("check");
  if (g.premove) mods.add("premove");
  if (g.view !== null) mods.add("viewing");
  if (g.flashBackToLive) mods.add("flash_back_to_live");
  if (g.promotion) mods.add("promotion");
  if (g.resignOpen) mods.add("resign_confirm");
  if (connDown) mods.add("reconnecting");
  if (g.outbox) mods.add("outbox");
  if (g.restarting) mods.add("restarting");
  if (s.frozen) mods.add("frozen");
  if (s.drawOffer && player) mods.add(s.drawOffer.by === me ? "draw_sent" : "draw_received");
  if (player && s.phase === "playing" && !s.players[opp].online) mods.add("opp_disconnected");
  const myClock = s.tc ? remaining(s.clocks, me, serverNow) : Infinity;
  if (player && s.phase === "playing" && s.clocks.run === me && myClock < LOW_TIME_MS) mods.add("low_time");
  const studyLeft = s.study ? s.study.endsAt - serverNow : Infinity;
  if (s.phase === "study" && studyLeft <= STUDY_LAST_MS) mods.add("study_last5");

  // ── primary ──
  let primary: DesignState;
  if (!g.joined) primary = "loading";
  else if (!player) primary = s.phase === "ended" ? "over_spectator" : "spectate";
  else if (g.serverError) primary = "server_error";
  else if (s.phase === "ended") {
    if (g.alreadyEnded) primary = "already_ended";
    else if (toastCode === "rematch_declined") primary = "over_rematch_declined";
    else if (toastCode === "rematch_expired") primary = "over_rematch_expired";
    else if (s.rematch) primary = s.rematch.by === me ? "over_rematch_sent" : "over_rematch_received";
    else if (s.result) {
      const w = s.result.winner;
      primary = OVER_BY_METHOD[s.result.method](w === null ? "draw" : w === me ? "win" : "loss");
    } else primary = "already_ended";
  } else if (s.phase === "waiting") primary = "waiting";
  else if (connDown) primary = s.phase === "study" ? "study_reconnect" : "reconnecting";
  else if (s.phase === "study")
    primary = s.rematchOf ? "rematch_study" : studyLeft <= STUDY_LAST_MS ? "study_last5" : "study";
  else if (s.phase === "first_move") {
    const mine = s.firstMove?.side === me;
    if (s.rematchOf) primary = mine ? (plies >= 1 ? "rematch_your" : "abort") : "rematch_first";
    else if (g.promotion) primary = "promotion";
    else if (toastCode === "illegal") primary = "illegal";
    else if (toastCode === "rejected") primary = "rejected";
    else primary = mine ? "abort" : "their_move";
  } else if (g.promotion) primary = "promotion";
  else if (g.resignOpen) primary = "resign_confirm";
  else if (toastCode === "illegal") primary = "illegal";
  else if (toastCode === "rejected") primary = "rejected";
  else if (toastCode === "premove_cancelled") primary = "premove_cancelled";
  else if (g.premove) primary = "premove";
  else if (s.drawOffer && s.drawOffer.by !== me) primary = "draw_received";
  else if (s.drawOffer && s.drawOffer.by === me) primary = "draw_sent";
  else if (toastCode === "draw_declined") primary = "draw_declined";
  else if (toastCode === "reconnected") primary = "reconnected";
  else if (!isBot && !s.players[opp].online) primary = "opp_disconnected";
  else if (toastCode === "opp_reconnected") primary = "opp_reconnected";
  else if (g.view !== null) primary = "viewing";
  else if (isBot) primary = "bot";
  else if (myTurn && s.inCheck) primary = "check";
  else if (mods.has("low_time")) primary = "low_time";
  else primary = myTurn ? "your_move" : "their_move";

  // ── zone ──
  let zone: Zone = "";
  if (primary === "loading") zone = "loading";
  else if (primary === "already_ended") zone = "ended";
  else if (s.phase === "ended") zone = "result";
  else if (g.serverError) zone = "error";
  else if (connDown && s.phase !== "study") zone = "reconnect";
  else if (player && s.phase === "playing" && !isBot && !s.players[opp].online && s.players[opp].graceEndsAt !== null)
    zone = "disc";
  else if (g.view !== null) zone = "viewing";
  else if (s.phase === "waiting") zone = "waiting";
  else if (s.phase === "study") zone = "study";
  else if (s.phase === "first_move") zone = "abort";
  else if (!player) zone = "spect";
  else if (isBot) zone = "coach";

  // ── actions ──
  let actions: ActionsVariant;
  if (primary === "loading") actions = "disabled";
  else if (primary === "already_ended") actions = "none";
  else if (s.phase === "ended") actions = "over";
  else if (!player) actions = "spect";
  else if (s.phase === "waiting") actions = "waiting";
  else if (s.phase === "study") actions = "study";
  else if (s.phase === "first_move") actions = s.firstMove?.side === me ? "abort" : "disabled";
  else if (isBot) actions = "bot";
  else actions = "online";

  // ── offer bar ──
  let bar: ViewState["bar"] = null;
  if (player && s.phase === "playing" && s.drawOffer && s.drawOffer.by !== me) bar = "draw";
  if (player && s.phase === "ended" && s.rematch) bar = s.rematch.by === me ? "rematch_out" : "rematch_in";

  // ── toast (store toasts plus the derived ones) ──
  let toast: Toast | null = g.toast;
  if (primary === "already_ended") toast = { code: "already_ended", kind: "info", at: 0 };
  if (primary === "study_reconnect") toast = { code: "study_reconnect", kind: "warn", at: 0 };
  // "martin_k accepted. Colours swapped: you play Black." stays up through the rematch's study phase, for the player
  // who OFFERED only: the one who accepted knows (FIX-A: both saw "<offerer> accepted").
  if (primary === "rematch_study" && !toast && !g.acceptedRematch)
    toast = { code: "rematch_accepted", kind: "good", at: 0, params: { color: me } };

  // ── status line ──
  let status: ViewState["status"] = null;
  if (s.phase === "first_move" && player) {
    status =
      primary === "rematch_your" ? { code: "rematch_your_note", params: { color: me } } : { code: "first_move_note" };
  }
  if (g.promotion) status = { code: "choose_piece" };
  else if (g.promotionCancelled)
    status = { code: "promotion_cancelled", params: { square: g.promotionCancelled.square } };
  else if (myTurn && s.inCheck && s.phase === "playing") status = { code: "check" };
  // A bot hint shows in the coach zone only (plan 4.3 #28); repeating it here printed it twice (FIX-A).
  else if (g.selected && myTurn && s.phase === "playing")
    status = { code: "selection_hint", params: { square: g.selected } };

  // ── countdown ──
  let countdown: ViewState["countdown"] = null;
  if (s.phase === "study" && s.study) countdown = { kind: "study", endsAt: s.study.endsAt };
  else if (s.phase === "first_move" && s.firstMove) countdown = { kind: "first_move", endsAt: s.firstMove.deadlineAt };
  else if (zone === "reconnect" && g.disconnectedAt !== null && !g.restarting) {
    countdown = { kind: "reconnect", endsAt: g.disconnectedAt + 30_000 };
  } else if (zone === "disc" && s.players[opp].graceEndsAt !== null)
    countdown = { kind: "grace", endsAt: s.players[opp].graceEndsAt! };
  else if (bar === "rematch_in" && s.rematch) countdown = { kind: "rematch", endsAt: s.rematch.expiresAt };

  // ── result ──
  let result: ResultView | null = null;
  if (s.phase === "ended" && s.result) {
    const w = s.result.winner;
    const kind: ResultView["kind"] =
      !player || s.result.method === "aborted" ? "neutral" : w === null ? "draw" : w === me ? "win" : "loss";
    result = {
      kind,
      method: s.result.method,
      winner: w,
      ply: s.result.ply,
      moveNo: moveNoOfPly(s.result.ply),
      abortedBy:
        s.result.method !== "aborted" || !s.result.abortedBy
          ? null
          : s.result.abortedBy === "timeout" || s.result.abortedBy === "stale"
            ? "timeout"
            : s.result.abortedBy === me
              ? "you"
              : "opponent",
      spectator: !player,
    };
  }

  // ── bars ──
  const mat = materialOf(s.fen);
  const tagFor = (side: Side): BarView["tag"] => {
    if (s.phase !== "ended" || !s.result || s.result.method === "aborted") return null;
    if (s.result.winner === null) return "DRAW";
    return s.result.winner === side ? "WON" : "LOST";
  };
  const barFor = (side: Side): BarView => {
    const mine = player && side === me;
    const p = s.players[side];
    let state: BarState = "";
    let sub: SubCode | null = null;
    if (primary === "loading") state = "skel";
    else if (s.phase === "waiting" && !p.online && !mine) {
      state = "waiting";
      sub = "not_joined";
    } else if (mine && connDown) state = "reconnecting";
    else if (!mine && s.phase === "playing" && !p.online) {
      state = "disconnected";
      sub = "disconnected";
    } else if (s.phase === "study") {
      if (p.ready) {
        state = "ready";
        sub = "ready";
      } else sub = s.rematchOf ? (mine ? "rematch_study_locked" : "rematch_study") : mine ? "study_locked" : "study";
    } else if (s.phase === "first_move") {
      const toMove = s.firstMove?.side === side;
      if (mine) sub = toMove ? "your_move_clock_not_started" : "clock_not_started";
      else if (toMove) state = "thinking";
      else sub = plies >= 1 ? "clock_starts_after_your_move" : "clock_not_started";
    } else if (s.phase === "playing") {
      const toMove = s.turn === side;
      if (mine) {
        if (g.premove) sub = "premove_queued";
        else if (toMove && s.inCheck) sub = "check";
        else if (g.promotion) sub = "promote";
        else if (toMove && mods.has("low_time")) sub = "low_time";
        else if (toMove) sub = "your_move";
      } else if (toMove) state = isBot && !g.bot?.thinking ? "" : "thinking";
    }
    return { side, state, sub, material: mat.ahead === side ? mat.diff : 0, tag: tagFor(side), online: p.online };
  };

  // ── board ──
  const shownPly = g.view !== null ? g.view - s.startPly : plies; // relative index into the move list
  const shownFen = g.view !== null ? fenAtPly(s, shownPly) : s.fen;
  const lastUci = shownPly > 0 ? splitMoves(s.moves)[shownPly - 1] : undefined;
  const last = lastUci ? parseUci(lastUci) : null;
  const badges: ViewState["board"]["badges"] = [];
  if (s.phase === "ended" && s.result && g.view === null) {
    const wk = kingSquare(s.fen, "w");
    const bk = kingSquare(s.fen, "b");
    const k = (side: Side) => (side === "w" ? wk : bk);
    const r = s.result;
    if (r.method === "checkmate" && r.winner) {
      const mated = k(otherSide(r.winner));
      const winner = k(r.winner);
      if (mated) badges.push({ square: mated, kind: "mate" });
      if (winner) badges.push({ square: winner, kind: "win" });
    } else if (r.method === "resignation" && r.winner) {
      const resigned = k(otherSide(r.winner));
      if (resigned) badges.push({ square: resigned, kind: "flag" });
    } else if (r.winner === null && r.method !== "aborted") {
      for (const sq of [wk, bk]) if (sq) badges.push({ square: sq, kind: "draw" });
    }
  }
  const ghost = g.outbox
    ? { from: g.outbox.uci.slice(0, 2), to: g.outbox.uci.slice(2, 4), kind: "outbox" as const }
    : g.premove
      ? { from: g.premove.from, to: g.premove.to, kind: "premove" as const }
      : null;
  let input: ViewState["board"]["input"] = "none";
  if (player && g.joined && g.view === null && !s.frozen && !g.pending) {
    if (myTurn && (s.phase === "playing" || s.phase === "first_move")) input = "move";
    else if (s.phase === "playing" && !isBot) input = "premove";
  }
  // Bot games: no input while the engine thinks, while another tab owns the game or after an engine failure.
  if (isBot && (g.bot?.thinking || g.bot?.otherTab || g.bot?.engineError)) input = "none";

  return {
    primary,
    modifiers: mods,
    zone,
    actions,
    bar,
    toast,
    status,
    bars: { me: barFor(me), opp: barFor(opp) },
    countdown,
    tick: s.phase === "playing" ? s.clocks.run : null,
    result,
    board: {
      fen: shownFen,
      orientation: me,
      lastMove: last ? [last.from, last.to] : null,
      checkSquare: g.view === null && s.inCheck ? kingSquare(s.fen, s.turn) : null,
      dimmed: s.phase === "waiting",
      ghost,
      badges,
      input,
    },
    draw: {
      label: s.drawOffer?.by === me ? "sent" : "offer",
      disabled:
        !player ||
        s.phase !== "playing" ||
        s.drawOffer?.by === me ||
        s.startPly + plies < s.canOfferAtPly[me] ||
        (isBot && plies < 2),
    },
  };
}
