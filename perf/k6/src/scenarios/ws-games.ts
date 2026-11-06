/**
 * Protocol v2 move RTT (phase-02 plan 12.8): every VU plays one fixture game between two v2 sockets, one move per
 * MOVE_EVERY_MS, and resigns after MAX_PLIES. `ws_move_duration` = command → ack.
 *
 *   npx tsx setup/v2-manifest.ts --games 25 --out setup/v2-manifest.json      (mints tokens, creates the games)
 *   k6 run dist/ws-games.js -e MANIFEST=../setup/v2-manifest.json
 *
 * Pass: ws_move_duration p95 < RTT + 50 ms (RTT_MS, default 10 for a local socket).
 */
import { Options } from 'k6/options';
import { SharedArray } from 'k6/data';
import { playV2Game, type ManifestGame, type V2Manifest } from '../lib/protocol-v2';
import { gameCompletionRate, gamesCompleted, gamesFailed, wsConnectDuration, wsConnectionSuccess, wsMoveDuration } from '../lib/metrics';

declare const __ENV: Record<string, string>;
declare const __VU: number;
declare function open(path: string): string;

const manifest = new SharedArray<V2Manifest>('v2-manifest', () => [JSON.parse(open(__ENV.MANIFEST || '../setup/v2-manifest.json')) as V2Manifest]);
const RTT = Number(__ENV.RTT_MS || 10);
const games = Number(__ENV.GAMES || 25);

export const options: Options = {
  scenarios: { ws_games: { executor: 'per-vu-iterations', vus: games, iterations: 1, maxDuration: '10m' } },
  thresholds: {
    ws_move_duration: [{ threshold: `p(95)<${RTT + 50}`, abortOnFail: false }],
    ws_connection_success: ['rate>0.99'],
    game_completion_rate: ['rate>0.95'],
  },
};

export default function (): void {
  const m = manifest[0]!;
  const game = m.games[(__VU - 1) % m.games.length] as ManifestGame;
  playV2Game(m.wsUrl, game, {
    moveEveryMs: Number(__ENV.MOVE_EVERY_MS || 1_000),
    maxPlies: Number(__ENV.MAX_PLIES || 20),
    timeoutMs: 5 * 60_000,
    onMoveRtt: (ms) => wsMoveDuration.add(ms),
    onConnect: (ms, ok) => {
      wsConnectDuration.add(ms);
      wsConnectionSuccess.add(ok);
    },
    onDone: ({ ok }) => {
      gameCompletionRate.add(ok);
      (ok ? gamesCompleted : gamesFailed).add(1);
    },
  });
}
