/**
 * Socket protocol v2 for k6 (phase-02 plan 7.4, 12.8): engine.io 4 + socket.io over `k6/websockets`, with the v2
 * handshake (`auth: { token, proto: 2 }` in the CONNECT packet), acked commands (`42<id>["cmd",payload]` →
 * `43<id>[ack]`), server events (`42["event",data]`) and ping/pong. One `V2Socket` per player.
 *
 * Tokens are minted outside k6 (setup/v2-manifest.ts, with SOCKET_TOKEN_SECRET of the target server); k6 never
 * holds a signing key.
 */
import { WebSocket } from 'k6/websockets';
import { setTimeout, clearTimeout } from 'k6/timers';
import { Chess } from 'chess.js';

export interface V2Ack {
  ok: boolean;
  code?: string;
  [key: string]: unknown;
}

export interface GameStateLite {
  ref: string;
  fen: string;
  phase: 'waiting' | 'study' | 'first_move' | 'playing' | 'ended';
  turn: 'w' | 'b';
  /** Plies played since the game's start position. */
  ply: number;
  you: { role: 'player' | 'spectator'; color?: 'w' | 'b' };
}

type Handler = (data: any) => void;

export function v2Url(base: string): string {
  return `${base.replace(/\/+$/, '')}/socket.io/?EIO=4&transport=websocket`;
}

export class V2Socket {
  private ws: WebSocket;
  private nextId = 1;
  private acks = new Map<number, { cb: (ack: V2Ack) => void; timer: ReturnType<typeof setTimeout> }>();
  private handlers = new Map<string, Handler[]>();
  connected = false;
  closed = false;
  connectError: string | null = null;
  readonly openedAt = Date.now();

  constructor(base: string, token: string, onConnect: (s: V2Socket) => void, onError?: (reason: string) => void) {
    this.ws = new WebSocket(v2Url(base));
    this.ws.onmessage = (e: { data: unknown }) => {
      const raw = String(e.data);
      if (raw === '2') return this.ws.send('3');
      if (raw.startsWith('0')) return this.ws.send(`40${JSON.stringify({ token, proto: 2 })}`);
      if (raw.startsWith('40')) {
        this.connected = true;
        return onConnect(this);
      }
      if (raw.startsWith('44')) {
        try {
          this.connectError = (JSON.parse(raw.slice(2)) as { message?: string }).message ?? 'connect_error';
        } catch {
          this.connectError = 'connect_error';
        }
        onError?.(this.connectError);
        return this.close();
      }
      if (raw.startsWith('43')) {
        const m = /^43(\d+)(\[.*)$/s.exec(raw);
        if (!m) return;
        const pending = this.acks.get(Number(m[1]));
        if (!pending) return;
        this.acks.delete(Number(m[1]));
        clearTimeout(pending.timer);
        pending.cb((JSON.parse(m[2]!) as V2Ack[])[0]!);
        return;
      }
      if (raw.startsWith('42')) {
        const [name, data] = JSON.parse(raw.slice(2)) as [string, unknown];
        for (const h of this.handlers.get(name) ?? []) h(data);
      }
    };
    this.ws.onclose = () => {
      this.closed = true;
      this.connected = false;
    };
    this.ws.onerror = () => onError?.('ws_error');
  }

  on(event: string, h: Handler): void {
    const list = this.handlers.get(event) ?? [];
    list.push(h);
    this.handlers.set(event, list);
  }

  /** An acked command; `cb` gets `{ok:false, code:"timeout"}` after `timeoutMs`. */
  emit(cmd: string, payload: unknown, cb: (ack: V2Ack) => void, timeoutMs = 5_000): void {
    if (!this.connected) return cb({ ok: false, code: 'not_connected' });
    const id = this.nextId++;
    const timer = setTimeout(() => {
      this.acks.delete(id);
      cb({ ok: false, code: 'timeout' });
    }, timeoutMs);
    this.acks.set(id, { cb, timer });
    this.ws.send(`42${id}${JSON.stringify([cmd, payload])}`);
  }

  close(): void {
    for (const { timer } of this.acks.values()) clearTimeout(timer);
    this.acks.clear();
    if (!this.closed) this.ws.close();
    this.closed = true;
  }
}

/** One uniformly random clientMoveId (≤ 16 chars, plan 7.4.6). */
export function clientMoveId(): string {
  return Math.random().toString(36).slice(2, 12);
}

// ─── One game between two v2 sockets (ws-games, ws-ramp) ─────────────────────────────────────────────────────────


export interface ManifestGame {
  ref: string;
  white: { ref: string; token: string };
  black: { ref: string; token: string };
}

export interface V2Manifest {
  /** ws(s)://host[:port] of the socket server. */
  wsUrl: string;
  /** Unix seconds; tokens live ≤ 15 min (plan 7.4.2). */
  expiresAt: number;
  games: ManifestGame[];
}

export interface PlayOptions {
  /** Think time of each move (plan 12.8: one move per 5 s per game). */
  moveEveryMs: number;
  /** The side to move resigns after this many plies. */
  maxPlies: number;
  /** Hard stop for the whole game. */
  timeoutMs: number;
  onMoveRtt(ms: number, ok: boolean): void;
  onConnect(ms: number, ok: boolean): void;
  onDone(result: { ok: boolean; plies: number; reason: string }): void;
}

/**
 * Plays one fixture game (both seats from one VU): join, first moves, random legal moves every `moveEveryMs`,
 * then a resignation. The move RTT is command → ack (`ws_move_duration`).
 */
export function playV2Game(base: string, game: ManifestGame, opts: PlayOptions): void {
  const chess = new Chess();
  let plies = 0;
  let done = false;
  let joined = 0;
  let thinkTimer: ReturnType<typeof setTimeout> | null = null;
  const seats: Partial<Record<'w' | 'b', V2Socket>> = {};

  const finish = (ok: boolean, reason: string) => {
    if (done) return;
    done = true;
    if (thinkTimer) clearTimeout(thinkTimer);
    clearTimeout(hardStop);
    seats.w?.close();
    seats.b?.close();
    opts.onDone({ ok, plies, reason });
  };
  const hardStop = setTimeout(() => finish(false, 'timeout'), opts.timeoutMs);

  const schedule = () => {
    if (done || joined < 2) return;
    if (thinkTimer) clearTimeout(thinkTimer);
    thinkTimer = setTimeout(() => {
      const side = chess.turn();
      const socket = seats[side];
      if (!socket || done) return;
      if (plies >= opts.maxPlies) {
        socket.emit('game:resign', { ref: game.ref }, (ack) => {
          if (!ack.ok) finish(false, `resign:${ack.code}`);
        });
        return;
      }
      const moves = chess.moves({ verbose: true });
      if (moves.length === 0) return finish(true, 'game_over');
      const m = moves[Math.floor(Math.random() * moves.length)]!;
      const uci = m.from + m.to + (m.promotion ?? '');
      const sentAt = Date.now();
      socket.emit('game:move', { ref: game.ref, ply: plies, uci, clientMoveId: clientMoveId() }, (ack) => {
        opts.onMoveRtt(Date.now() - sentAt, ack.ok);
        if (!ack.ok) finish(false, `move:${ack.code}`);
      });
    }, opts.moveEveryMs);
  };

  const seat = (side: 'w' | 'b', token: string) => {
    const t0 = Date.now();
    seats[side] = new V2Socket(
      base,
      token,
      (s) => {
        opts.onConnect(Date.now() - t0, true);
        // 15 s like the web client (JOIN_TIMEOUT_MS): a first join loads the game row (Neon round trips).
        s.emit('game:join', { ref: game.ref }, (ack) => {
          if (!ack.ok) return finish(false, `join:${ack.code}`);
          const state = ack.state as { fen: string; moves: string[] } | undefined;
          if (side === 'w' && state) {
            chess.load(state.fen);
            plies = state.moves.length;
          }
          joined++;
          schedule();
        }, 15_000);
        // Only White's socket drives the local board (one source of truth per game).
        if (side === 'w') {
          s.on('move:applied', (e: { uci: string; ply: number }) => {
            chess.move({ from: e.uci.slice(0, 2), to: e.uci.slice(2, 4), promotion: e.uci[4] });
            plies = e.ply;
            schedule();
          });
          s.on('game:ended', () => finish(true, 'ended'));
        }
      },
      (reason) => {
        opts.onConnect(Date.now() - t0, false);
        finish(false, `connect:${reason}`);
      },
    );
  };
  seat('w', game.white.token);
  seat('b', game.black.token);
}
