/**
 * Smoke Test — 1 VU, 1 full game lifecycle.
 *
 * Proves the entire flow works end-to-end before scaling up:
 *   HTTP create-game → HTTP join → WS connect (x2) → analysis phase →
 *   game_started → play 10+ moves → resign → game_over
 *
 * Usage:
 *   cd perf/k6 && pnpm run build
 *   k6 run dist/smoke.js
 */

import { check, sleep, fail } from 'k6';
import { Options } from 'k6/options';
import http from 'k6/http';
import { SharedArray } from 'k6/data';

import { CONFIG, apiUrl } from '../lib/config';
import { playGame } from '../lib/game-player';
import {
  httpCreateGameDuration,
  httpJoinGameDuration,
  httpErrorRate,
  gameCompletionRate,
  gamesFailed,
} from '../lib/metrics';
import { TestUser } from '../lib/user-pool';

// --- Load user manifest ---
const users = new SharedArray('users', function () {
  try {
    return JSON.parse(open('../setup/user-manifest.json')) as TestUser[];
  } catch {
    return [] as TestUser[];
  }
});

// --- k6 Options ---
export const options: Options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_error_rate: ['rate<0.1'],
    ws_connection_success: ['rate>0.9'],
    game_completion_rate: ['rate>0.9'],
  },
};

// --- Main ---
export default function () {
  const playerA = getUserForSmoke(0);
  const playerB = getUserForSmoke(1);

  console.log(`[smoke] === SMOKE TEST START ===`);
  console.log(`[smoke] PlayerA: ${playerA.referenceId}`);
  console.log(`[smoke] PlayerB: ${playerB.referenceId}`);
  console.log(`[smoke] API: ${apiUrl('')}`);
  console.log(`[smoke] Config: time=${CONFIG.INITIAL_TIME_SECONDS}+${CONFIG.INCREMENT_SECONDS}, minMoves=${CONFIG.MIN_MOVES}, mode=${CONFIG.GAME_MODE}`);

  // ─── PHASE 1: HTTP — Create Game ───
  console.log(`[smoke] Phase 1: Creating game...`);
  const createStart = Date.now();

  const createRes = http.post(
    apiUrl('/api/chess/create-game'),
    JSON.stringify({
      userReferenceId: playerA.referenceId,
      initialTimeSeconds: CONFIG.INITIAL_TIME_SECONDS,
      incrementSeconds: CONFIG.INCREMENT_SECONDS,
      gameMode: CONFIG.GAME_MODE,
      playAsLegend: false,
      selectedLegend: null,
      selectedOpening: null,
    }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'create-game' } },
  );

  httpCreateGameDuration.add(createRes.timings.duration);

  console.log(`[smoke] create-game response: status=${createRes.status}, duration=${createRes.timings.duration}ms`);

  const createOk = check(createRes, {
    'create-game status 201': (r) => r.status === 201,
    'create-game has referenceId': (r) => {
      try {
        const body = JSON.parse(r.body as string);
        return body?.data?.game?.referenceId != null;
      } catch { return false; }
    },
  });

  if (!createOk) {
    httpErrorRate.add(1);
    gamesFailed.add(1);
    gameCompletionRate.add(false);
    console.error(`[smoke] create-game FAILED: ${createRes.status}`);
    console.error(`[smoke] Response body: ${(createRes.body as string)?.substring(0, 500)}`);
    return;
  }
  httpErrorRate.add(0);

  const createBody = JSON.parse(createRes.body as string);
  const gameRefId = createBody.data.game.referenceId as string;
  const startingFen = createBody.data.game.startingFen;
  console.log(`[smoke] Game created: ref=${gameRefId}, fen=${startingFen?.substring(0, 30)}...`);

  // ─── PHASE 1b: HTTP — Join Game ───
  console.log(`[smoke] Phase 1b: Joining game...`);

  const joinRes = http.post(
    apiUrl('/api/chess/join'),
    JSON.stringify({
      gameReferenceId: gameRefId,
      opponentReferenceId: playerB.referenceId,
    }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'join-game' } },
  );

  httpJoinGameDuration.add(joinRes.timings.duration);

  console.log(`[smoke] join-game response: status=${joinRes.status}, duration=${joinRes.timings.duration}ms`);

  const joinOk = check(joinRes, {
    'join-game status 200': (r) => r.status === 200,
  });

  if (!joinOk) {
    httpErrorRate.add(1);
    gamesFailed.add(1);
    gameCompletionRate.add(false);
    console.error(`[smoke] join-game FAILED: ${joinRes.status}`);
    console.error(`[smoke] Response body: ${(joinRes.body as string)?.substring(0, 500)}`);
    return;
  }
  httpErrorRate.add(0);

  console.log(`[smoke] Game joined. Phase 2-5: WebSocket game play...`);

  // ─── PHASE 2-5: Play the game via WebSocket ───
  // playGame() is event-driven and non-blocking. The VU stays alive while
  // WebSocket connections are open. Metrics and logs are recorded inside
  // game-player.ts when the game completes or times out.
  playGame(gameRefId, playerA.referenceId, playerB.referenceId, 'smoke');

  console.log(`[smoke] === SMOKE: WS game initiated (event-driven, check game-player logs) ===`);
}

// --- User helpers ---

declare const __ENV: Record<string, string>;

function getUserForSmoke(index: number): { referenceId: string } {
  if (users.length > index) {
    return users[index] as TestUser;
  }

  const envKey = index === 0 ? 'PLAYER_A_REF' : 'PLAYER_B_REF';
  const ref = __ENV[envKey];
  if (ref) {
    return { referenceId: ref };
  }

  fail(`No user at index ${index}. Set PLAYER_A_REF/PLAYER_B_REF env vars or create user-manifest.json`);
  return { referenceId: '' };
}
