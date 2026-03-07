/**
 * WebSocket Games Test — Full game lifecycle at scale.
 *
 * Each VU runs the complete flow:
 *   HTTP create → HTTP join → WS connect (x2) →
 *   analysis phase → play 10+ moves → resign → game_over
 *
 * Usage:
 *   k6 run dist/ws-games.js --vus 10    # 10 concurrent games
 *   k6 run dist/ws-games.js --vus 50    # 50 concurrent games
 *   k6 run dist/ws-games.js --vus 250   # 250 concurrent games (target)
 */

import { check, sleep } from 'k6';
import { Options } from 'k6/options';
import http from 'k6/http';
import { SharedArray } from 'k6/data';

import { CONFIG, apiUrl } from '../lib/config';
import { playGame } from '../lib/game-player';
import {
  httpCreateGameDuration,
  httpJoinGameDuration,
  httpErrorRate,
} from '../lib/metrics';
import { TestUser } from '../lib/user-pool';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../setup/user-manifest.json')) as TestUser[];
});

// Default: 30 VUs x 3 iterations = 90 games (uses all 60 users)
// Override via CLI: k6 run dist/ws-games.js --vus 10 --iterations 10
const vuCount = parseInt(__ENV.WS_VUS || '30', 10);
const iterCount = parseInt(__ENV.WS_ITERS || '3', 10);

export const options: Options = {
  scenarios: {
    ws_games: {
      executor: 'per-vu-iterations',
      vus: vuCount,
      iterations: iterCount,
      maxDuration: '15m',
    },
  },
  thresholds: {
    http_error_rate: ['rate<0.05'],
    ws_connection_success: ['rate>0.95'],
    ws_move_duration: ['p(95)<500'],
    game_completion_rate: ['rate>0.9'],
  },
};

export default function () {
  const vuIndex = (__VU - 1) % Math.floor(users.length / 2);
  const playerA = users[vuIndex * 2] as TestUser;
  const playerB = users[vuIndex * 2 + 1] as TestUser;

  console.log(`[ws-game] VU ${__VU} iter ${__ITER}: Starting — playerA=${playerA.referenceId.substring(0, 8)}, playerB=${playerB.referenceId.substring(0, 8)}`);

  // Phase 1: HTTP create + join
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

  if (!check(createRes, { 'create 201': (r) => r.status === 201 })) {
    httpErrorRate.add(1);
    console.error(`[ws-game] VU ${__VU}: create-game FAILED — status=${createRes.status}, duration=${createRes.timings.duration}ms`);
    console.error(`[ws-game] VU ${__VU}: Response: ${(createRes.body as string)?.substring(0, 300)}`);
    sleep(2);
    return;
  }
  httpErrorRate.add(0);

  const gameRefId = JSON.parse(createRes.body as string).data.game.referenceId;
  console.log(`[ws-game] VU ${__VU}: create-game OK — ref=${gameRefId.substring(0, 8)}, took=${createRes.timings.duration}ms`);

  const joinRes = http.post(
    apiUrl('/api/chess/join'),
    JSON.stringify({
      gameReferenceId: gameRefId,
      opponentReferenceId: playerB.referenceId,
    }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'join-game' } },
  );

  httpJoinGameDuration.add(joinRes.timings.duration);

  if (!check(joinRes, { 'join 200': (r) => r.status === 200 })) {
    httpErrorRate.add(1);
    console.error(`[ws-game] VU ${__VU}: join-game FAILED — status=${joinRes.status}, gameRef=${gameRefId.substring(0, 8)}`);
    console.error(`[ws-game] VU ${__VU}: Response: ${(joinRes.body as string)?.substring(0, 300)}`);
    sleep(2);
    return;
  }
  httpErrorRate.add(0);

  console.log(`[ws-game] VU ${__VU}: join-game OK — took=${joinRes.timings.duration}ms, entering WS phase`);

  // Phase 2-5: Play the game over WebSocket (event-driven, non-blocking).
  // game-player.ts handles all WS logging and metrics internally.
  playGame(gameRefId, playerA.referenceId, playerB.referenceId, `ws-game-VU${__VU}`);
}

declare const __VU: number;
declare const __ITER: number;
