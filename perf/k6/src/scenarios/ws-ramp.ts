/**
 * WebSocket Ramp Test — Gradually ramp up concurrent games.
 *
 * Uses per-vu-iterations with staggered start delays to simulate a ramp.
 * Each VU waits a random delay (spread over RAMP_OVER seconds), then plays
 * RAMP_GAMES games sequentially. This avoids thundering herd and prevents
 * fast retry loops from flooding the server on failures.
 *
 * Default: 100 VUs × 10 games each = 1,000 total games, staggered over 5 min.
 * Each game takes ~25s (15s analysis + 10s play), so at steady state ~100
 * games are in-flight concurrently.
 *
 * Usage:
 *   k6 run dist/ws-ramp.js                                    # 1,000 games
 *   k6 run dist/ws-ramp.js -e RAMP_VUS=50 -e RAMP_GAMES=5    # 250 games
 *   k6 run dist/ws-ramp.js -e RAMP_VUS=200 -e RAMP_GAMES=5   # 1,000 games
 *   k6 run dist/ws-ramp.js -e RAMP_OVER=300                   # stagger over 5 min
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

const vuCount = parseInt(__ENV.RAMP_VUS || '100', 10);
const gamesPerVU = parseInt(__ENV.RAMP_GAMES || '10', 10);
const rampOverSeconds = parseInt(__ENV.RAMP_OVER || '300', 10); // 5 min stagger

export const options: Options = {
  scenarios: {
    ws_ramp: {
      executor: 'per-vu-iterations',
      vus: vuCount,
      iterations: gamesPerVU,
      maxDuration: '30m',
    },
  },
  thresholds: {
    http_error_rate: ['rate<0.10'],
    ws_connection_success: ['rate>0.90'],
    ws_move_duration: ['p(95)<1000'],
    game_completion_rate: ['rate>0.80'],
  },
};

export default function () {
  const vuIndex = (__VU - 1) % Math.floor(users.length / 2);
  const playerA = users[vuIndex * 2] as TestUser;
  const playerB = users[vuIndex * 2 + 1] as TestUser;
  const tag = `ramp-VU${__VU}-i${__ITER}`;

  // On the first iteration, each VU waits a random delay to stagger start.
  // VUs spread their start over RAMP_OVER seconds, creating a gradual ramp.
  if (__ITER === 0) {
    const delay = Math.random() * rampOverSeconds;
    console.log(`[${tag}] Stagger delay: ${delay.toFixed(1)}s`);
    sleep(delay);
  }

  // Phase 1: HTTP create
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
    console.error(`[${tag}] create-game FAILED — status=${createRes.status}`);
    sleep(5);
    return;
  }
  httpErrorRate.add(0);

  const gameRefId = JSON.parse(createRes.body as string).data.game.referenceId;

  // Phase 2: HTTP join
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
    console.error(`[${tag}] join-game FAILED — status=${joinRes.status}`);
    sleep(5);
    return;
  }
  httpErrorRate.add(0);

  // Phase 3-5: Play the game over WebSocket (event-driven, non-blocking)
  playGame(gameRefId, playerA.referenceId, playerB.referenceId, tag);
}

declare const __VU: number;
declare const __ITER: number;
