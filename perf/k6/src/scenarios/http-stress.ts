/**
 * HTTP Stress Test — 250 VUs, HTTP-only (create-game + join).
 *
 * Tests the Next.js API endpoints under load WITHOUT WebSocket connections.
 * Each VU repeatedly creates a game and has a second player join it.
 *
 * Usage:
 *   k6 run dist/http-stress.js
 *   k6 run dist/http-stress.js --vus 50  # start smaller
 */

import { check, sleep } from 'k6';
import { Options } from 'k6/options';
import http from 'k6/http';
import { SharedArray } from 'k6/data';

import { CONFIG, apiUrl } from '../lib/config';
import {
  httpCreateGameDuration,
  httpJoinGameDuration,
  httpErrorRate,
} from '../lib/metrics';
import { TestUser } from '../lib/user-pool';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../setup/user-manifest.json')) as TestUser[];
});

export const options: Options = {
  scenarios: {
    http_stress: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 50 },
        { duration: '1m', target: 125 },
        { duration: '1m', target: 250 },
        { duration: '3m', target: 250 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_create_game_duration: ['p(95)<2000'],
    http_join_game_duration: ['p(95)<2000'],
    http_error_rate: ['rate<0.05'],
  },
};

export default function () {
  const vuIndex = (__VU - 1) % Math.floor(users.length / 2);
  const playerA = users[vuIndex * 2] as TestUser;
  const playerB = users[vuIndex * 2 + 1] as TestUser;
  const iterStart = Date.now();

  // Create game
  const createUrl = apiUrl('/api/chess/create-game');
  console.log(`[http-stress] VU ${__VU} iter ${__ITER}: create-game for ${playerA.referenceId.substring(0, 8)} → ${createUrl}`);

  const createRes = http.post(
    createUrl,
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

  const createOk = check(createRes, {
    'create-game 201': (r) => r.status === 201,
  });

  if (!createOk) {
    httpErrorRate.add(1);
    console.error(`[http-stress] VU ${__VU}: create-game FAILED — status=${createRes.status}, duration=${createRes.timings.duration}ms`);
    console.error(`[http-stress] VU ${__VU}: Response body: ${(createRes.body as string)?.substring(0, 300)}`);
    console.error(`[http-stress] VU ${__VU}: Request payload: userRef=${playerA.referenceId}`);
    sleep(1);
    return;
  }
  httpErrorRate.add(0);

  const createBody = JSON.parse(createRes.body as string);
  const gameRefId = createBody.data.game.referenceId;
  console.log(`[http-stress] VU ${__VU}: create-game OK — ref=${gameRefId.substring(0, 8)}, duration=${createRes.timings.duration}ms`);

  // Join game
  const joinRes = http.post(
    apiUrl('/api/chess/join'),
    JSON.stringify({
      gameReferenceId: gameRefId,
      opponentReferenceId: playerB.referenceId,
    }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'join-game' } },
  );

  httpJoinGameDuration.add(joinRes.timings.duration);

  const joinOk = check(joinRes, {
    'join-game 200': (r) => r.status === 200,
  });

  if (!joinOk) {
    httpErrorRate.add(1);
    console.error(`[http-stress] VU ${__VU}: join-game FAILED — status=${joinRes.status}, duration=${joinRes.timings.duration}ms, gameRef=${gameRefId.substring(0, 8)}`);
    console.error(`[http-stress] VU ${__VU}: Response body: ${(joinRes.body as string)?.substring(0, 300)}`);
  } else {
    httpErrorRate.add(0);
    const totalMs = Date.now() - iterStart;
    console.log(`[http-stress] VU ${__VU}: join-game OK — duration=${joinRes.timings.duration}ms, totalIter=${totalMs}ms`);
  }

  sleep(0.5);
}

declare const __VU: number;
declare const __ITER: number;
