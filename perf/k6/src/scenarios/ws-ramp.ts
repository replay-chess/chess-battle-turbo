/**
 * Protocol v2 capacity ramp (phase-02 plan 9.6, 12.8): 250 → 2,000 sockets (125 → 1,000 concurrent games, two
 * sockets each), one move per 5 s per game, 15 minutes. Run once per phase on the dev OCI box from a GitHub runner
 * after the Neon split (owner, stage B); the local 50-socket smoke is SMOKE=1 against :3002.
 *
 *   npx tsx setup/v2-manifest.ts --games 1000 --ws wss://ws-dev.80-225-200-210.sslip.io --out setup/v2-manifest.json
 *   k6 run dist/ws-ramp.js -e MANIFEST=../setup/v2-manifest.json --summary-export ../results/p02-ws-ramp-<sha>.json
 *   k6 run dist/ws-ramp.js -e SMOKE=1 -e MANIFEST=../setup/v2-manifest.json     # 25 games = 50 sockets, ~1 min
 *
 * Client-side gates here; the server gates (ws.move_latency_ms p95 < 5 ms, ws.loop_lag_ms p99 < 20 ms, RSS < 1 GB,
 * 0 persist failures, ≤ 1 checkpoint per 10 plies) are read from /internal/metrics and Sentry (perf/README.md).
 * Tokens live 15 minutes: mint the manifest right before the run.
 */
import { Options } from 'k6/options';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import { sleep } from 'k6';
import { playV2Game, type ManifestGame, type V2Manifest } from '../lib/protocol-v2';
import {
  activeGames,
  gameCompletionRate,
  gamesCompleted,
  gamesFailed,
  wsConnectDuration,
  wsConnectionSuccess,
  wsMoveDuration,
} from '../lib/metrics';

declare const __ENV: Record<string, string>;
declare function open(path: string): string;

const manifest = new SharedArray<V2Manifest>('v2-manifest', () => [JSON.parse(open(__ENV.MANIFEST || '../setup/v2-manifest.json')) as V2Manifest]);
const SMOKE = __ENV.SMOKE === '1';

export const options: Options = SMOKE
  ? {
      scenarios: { smoke: { executor: 'per-vu-iterations', vus: 25, iterations: 1, maxDuration: '5m' } },
      thresholds: {
        ws_connection_success: [{ threshold: 'rate>0.99', abortOnFail: true }],
        ws_move_duration: ['p(95)<100'],
        game_completion_rate: ['rate>0.95'],
      },
    }
  : {
      scenarios: {
        ramp: {
          executor: 'ramping-vus',
          startVUs: 125,
          stages: [
            { duration: '3m', target: 500 },
            { duration: '3m', target: 1000 },
            { duration: '9m', target: 1000 },
          ],
          gracefulRampDown: '30s',
        },
      },
      thresholds: {
        ws_connection_success: [{ threshold: 'rate>0.99', abortOnFail: true, delayAbortEval: '1m' }],
        ws_move_duration: [{ threshold: 'p(95)<250', abortOnFail: true, delayAbortEval: '2m' }],
        game_completion_rate: ['rate>0.95'],
      },
    };

export default function (): void {
  const m = manifest[0]!;
  // Every iteration plays a game of its own (a finished game cannot be replayed); idle once the manifest is used up.
  const index = exec.scenario.iterationInTest;
  if (index >= m.games.length) {
    sleep(5);
    return;
  }
  const game = m.games[index] as ManifestGame;
  // Smoke: 25 games start over ~7.5 s (a real crowd arrives spread out; a burst of 50 first joins is the restore case,
  // covered by restart.int.test.ts and the dev-box ramp).
  if (SMOKE) sleep(index * 0.3);
  activeGames.add(1);
  playV2Game(m.wsUrl, game, {
    moveEveryMs: SMOKE ? 1_000 : 5_000,
    maxPlies: SMOKE ? 12 : 60,
    timeoutMs: SMOKE ? 3 * 60_000 : 10 * 60_000,
    onMoveRtt: (ms) => wsMoveDuration.add(ms),
    onConnect: (ms, ok) => {
      wsConnectDuration.add(ms);
      wsConnectionSuccess.add(ok);
    },
    onDone: ({ ok, reason, plies }) => {
      if (!ok) console.warn(`game ${game.ref.slice(0, 8)} failed after ${plies} plies: ${reason}`);
      activeGames.add(-1);
      gameCompletionRate.add(ok);
      (ok ? gamesCompleted : gamesFailed).add(1);
    },
  });
}
