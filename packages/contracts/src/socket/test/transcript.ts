// Golden transcript format (phase-02 plan §12.3). One file per lit design state in
// PKG/chess-fixtures/socket/transcripts/<state>.json: the commands sent, the expected events (time-normalised to
// T0 = 1793563200000) and the expected design state per role. The socket server test (WP-D) replays the commands
// against an in-process server and compares the events; game-core's viewState test (WP-B) feeds the same events to
// the client reducer. Changing either side alone fails a test. Payloads are checked against the protocol schemas by
// transcripts.test.ts.
import { z } from "zod";
import { GameSnapshot } from "../../http/games";
import { GameState } from "../game";

/** The 55 V3Game states of §4.3, in table order, with whether P2 lights them. */
export const DESIGN_STATES = [
  ["loading", true], ["waiting", true], ["study", true], ["study_last5", true], ["study_reconnect", true],
  ["abort", true], ["rematch_study", true], ["rematch_first", true], ["rematch_your", true], ["your_move", true],
  ["their_move", true], ["premove", true], ["premove_cancelled", true], ["check", true], ["illegal", true],
  ["promotion", true], ["rejected", true], ["low_time", true], ["viewing", true], ["draw_sent", true],
  ["draw_received", true], ["draw_declined", true], ["resign_confirm", true], ["reconnecting", true],
  ["reconnected", true], ["opp_disconnected", true], ["opp_reconnected", true], ["bot", true], ["tournament", false],
  ["already_ended", true], ["server_error", true], ["spectate", true], ["over_checkmate_win", true],
  ["over_checkmate_loss", true], ["over_resign_win", true], ["over_resign_loss", true], ["over_timeout_win", true],
  ["over_timeout_loss", true], ["over_timeout_insufficient", true], ["over_stalemate", true], ["over_threefold", true],
  ["over_fifty", true], ["over_insufficient", true], ["over_agreement", true], ["over_abandoned", true],
  ["over_aborted", true], ["over_analysing", false], ["over_legend", false], ["over_tournament", false],
  ["over_guest", false], ["over_spectator", true], ["over_rematch_sent", true], ["over_rematch_received", true],
  ["over_rematch_declined", true], ["over_rematch_expired", true],
] as const satisfies readonly (readonly [string, boolean])[];

export type DesignState = (typeof DESIGN_STATES)[number][0];
export const DESIGN_STATE_NAMES = DESIGN_STATES.map(([name]) => name) as DesignState[];
export const LIT_STATES = DESIGN_STATES.filter(([, lit]) => lit).map(([name]) => name) as DesignState[];

/** Modifiers that combine with the primary state (§4.3 "How the 55 states map onto code"). */
export const MODIFIERS = [
  "check", "premove", "low_time", "viewing", "promotion", "draw_received", "draw_sent", "reconnecting", "opp_disconnected",
] as const;

export const ZONES = [
  "loading", "waiting", "study", "coach", "viewing", "reconnect", "disc", "abort", "tour", "error", "ended", "spect", "result",
] as const;

export const ACTIONS = ["online", "bot", "abort", "spect", "study", "waiting", "disabled", "over", "none"] as const;

export const Role = z.enum(["w", "b", "spectator"]);
export type Role = z.infer<typeof Role>;

/** Client-side actions that never touch the wire (the client reducer and the board handle them). */
export const LOCAL_ACTIONS = [
  "disconnect", // own socket down
  "reconnect", // socket back (the next step is the rejoin)
  "advance", // args.ms: time passes (client clock)
  "select", // args.square
  "premove", // args.uci
  "cancel_premove", // Esc / right-click
  "drop_illegal", // args.uci: local validation refuses it
  "promotion_open", // args.uci without the piece
  "promotion_cancel",
  "view_ply", // args.ply
  "back_to_live",
  "open_resign_confirm",
  "ack_timeout", // args.command
  "sync_failed", // a game:sync that did not answer
] as const;

const Step = z.union([
  /** The RSC / HTTP snapshot the page renders first (`GET /api/games/[ref]` shape). */
  z.strictObject({ t: z.number().int().min(0), actor: Role, snapshot: GameSnapshot }),
  /** A command and its ack; `ack: null` = still pending when the expectations are read. */
  z.strictObject({
    t: z.number().int().min(0),
    actor: Role,
    send: z.string(),
    payload: z.unknown(),
    ack: z.unknown().nullable(),
  }),
  /** A server event and who receives it. */
  z.strictObject({
    t: z.number().int().min(0),
    to: z.array(Role).min(1),
    event: z.string(),
    payload: z.unknown(),
  }),
  z.strictObject({
    t: z.number().int().min(0),
    actor: Role,
    local: z.enum(LOCAL_ACTIONS),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
]);
export type TranscriptStep = z.infer<typeof Step>;

const Expectation = z.strictObject({
  primary: z.enum(DESIGN_STATE_NAMES as [DesignState, ...DesignState[]]),
  modifiers: z.array(z.enum(MODIFIERS)).optional(),
  zone: z.enum(ZONES).nullable().optional(),
  actions: z.enum(ACTIONS).optional(),
  /** The toast the state shows (copy key or text), if any. */
  toast: z.string().nullable().optional(),
});

export const Transcript = z.strictObject({
  format: z.literal(1),
  state: z.enum(DESIGN_STATE_NAMES as [DesignState, ...DesignState[]]),
  /** Row number in §4.3. */
  number: z.number().int().min(1).max(55),
  /** `skeleton`: commands and events are protocol-valid; positions and expectations beyond `primary` are WP-B's. */
  status: z.enum(["skeleton", "golden"]),
  summary: z.string(),
  t0: z.literal(1_793_563_200_000),
  /** Expected design state per observed role, read after the last step. */
  expect: z.partialRecord(Role, Expectation),
  steps: z.array(Step).min(1),
  /** Open items for the owners (WP-B fixtures, WP-D server behaviour). */
  todo: z.array(z.string()).optional(),
});
export type Transcript = z.infer<typeof Transcript>;

export { GameState };
