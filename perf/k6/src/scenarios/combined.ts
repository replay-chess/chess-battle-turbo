/**
 * Combined Load Test — All scenarios simultaneously.
 *
 * Runs direct games, matchmaking, and tournament concurrently
 * to simulate real-world mixed traffic.
 *
 * Usage:
 *   k6 run dist/combined.js
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
  httpMatchmakingDuration,
  httpErrorRate,
  matchmakingMatchRate,
  matchmakingPollCount,
} from '../lib/metrics';
import { TestUser } from '../lib/user-pool';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../setup/user-manifest.json')) as TestUser[];
});

export const options: Options = {
  scenarios: {
    // 150 VUs playing direct (friend) games
    direct_games: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 30 },
        { duration: '1m', target: 75 },
        { duration: '1m', target: 150 },
        { duration: '7m', target: 150 },
        { duration: '1m', target: 0 },
      ],
      exec: 'directGame',
    },
    // 100 VUs doing matchmaking
    matchmaking: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '7m', target: 100 },
        { duration: '1m', target: 0 },
      ],
      exec: 'matchmakingGame',
      startTime: '30s',
    },
  },
  thresholds: {
    http_error_rate: ['rate<0.1'],
    ws_connection_success: ['rate>0.9'],
    game_completion_rate: ['rate>0.85'],
    matchmaking_match_rate: ['rate>0.7'],
  },
};

// ─── Direct Games (first 300 users: 0-299) ───
export function directGame() {
  const vuIndex = (__VU - 1) % 150;
  const playerA = users[vuIndex * 2] as TestUser;
  const playerB = users[vuIndex * 2 + 1] as TestUser;
  const iterStart = Date.now();

  console.log(`[combined-direct] VU ${__VU} iter ${__ITER}: Creating game for ${playerA.referenceId.substring(0, 8)}`);

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
    console.error(`[combined-direct] VU ${__VU}: create FAILED — status=${createRes.status}, body=${(createRes.body as string)?.substring(0, 200)}`);
    sleep(2);
    return;
  }
  httpErrorRate.add(0);

  const gameRefId = JSON.parse(createRes.body as string).data.game.referenceId;
  console.log(`[combined-direct] VU ${__VU}: Created game=${gameRefId.substring(0, 8)}, took=${createRes.timings.duration}ms`);

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
    console.error(`[combined-direct] VU ${__VU}: join FAILED — status=${joinRes.status}, body=${(joinRes.body as string)?.substring(0, 200)}`);
    sleep(2);
    return;
  }
  httpErrorRate.add(0);

  console.log(`[combined-direct] VU ${__VU}: Joined, entering WS phase`);
  playGame(gameRefId, playerA.referenceId, playerB.referenceId, `comb-direct-VU${__VU}`);
}

// ─── Matchmaking (users 300-499) ───
export function matchmakingGame() {
  const userIndex = 300 + ((__VU - 1) % 200);
  const user = users[userIndex] as TestUser;
  const iterStart = Date.now();

  console.log(`[combined-mm] VU ${__VU} iter ${__ITER}: user=${user.referenceId.substring(0, 8)}`);

  if (__VU % 2 === 0) {
    sleep(0.3);
  }

  const queueRes = http.post(
    apiUrl('/api/matchmaking/create-match-request'),
    JSON.stringify({
      userReferenceId: user.referenceId,
      initialTimeSeconds: CONFIG.INITIAL_TIME_SECONDS,
      incrementSeconds: CONFIG.INCREMENT_SECONDS,
      legendReferenceId: null,
      openingReferenceId: null,
    }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'matchmaking-queue' } },
  );

  httpMatchmakingDuration.add(queueRes.timings.duration);

  if (!check(queueRes, { 'queue 201': (r) => r.status === 201 })) {
    httpErrorRate.add(1);
    matchmakingMatchRate.add(false);
    console.error(`[combined-mm] VU ${__VU}: Queue FAILED — status=${queueRes.status}, body=${(queueRes.body as string)?.substring(0, 200)}`);
    sleep(2);
    return;
  }
  httpErrorRate.add(0);

  const queueBody = JSON.parse(queueRes.body as string);
  const queueRefId = queueBody.data.referenceId as string;

  let gameRefId: string | null = null;
  if (queueBody.data.status === 'MATCHED' && queueBody.data.gameReferenceId) {
    gameRefId = queueBody.data.gameReferenceId;
    console.log(`[combined-mm] VU ${__VU}: INSTANT MATCH — game=${gameRefId.substring(0, 8)}`);
  }

  let pollCount = 0;
  if (!gameRefId) {
    for (let i = 0; i < CONFIG.MATCH_POLL_MAX_ATTEMPTS; i++) {
      sleep(CONFIG.MATCH_POLL_INTERVAL_MS / 1000);
      pollCount++;

      const statusRes = http.get(
        apiUrl(`/api/matchmaking/match-status?referenceId=${queueRefId}`),
        { tags: { name: 'matchmaking-poll' } },
      );

      if (statusRes.status !== 200) {
        console.error(`[combined-mm] VU ${__VU}: Poll #${pollCount} — HTTP ${statusRes.status}`);
        continue;
      }

      const body = JSON.parse(statusRes.body as string);
      const status = body.data?.status;

      if (status === 'MATCHED' && body.data?.gameReferenceId) {
        gameRefId = body.data.gameReferenceId;
        console.log(`[combined-mm] VU ${__VU}: Matched after ${pollCount} polls — game=${gameRefId!.substring(0, 8)}`);
        break;
      }
      if (status === 'EXPIRED' || status === 'CANCELLED') {
        console.log(`[combined-mm] VU ${__VU}: ${status} after ${pollCount} polls`);
        break;
      }
    }
  }

  matchmakingPollCount.add(pollCount);

  if (!gameRefId) {
    matchmakingMatchRate.add(false);
    console.error(`[combined-mm] VU ${__VU}: NO MATCH after ${pollCount} polls`);
    sleep(1);
    return;
  }

  matchmakingMatchRate.add(true);

  if (__VU % 2 === 1) {
    const opponentIndex = userIndex % 2 === 0 ? userIndex + 1 : userIndex - 1;
    const opponent = users[opponentIndex] as TestUser;
    console.log(`[combined-mm] VU ${__VU}: Playing game against ${opponent.referenceId.substring(0, 8)}`);
    playGame(gameRefId, user.referenceId, opponent.referenceId, `comb-mm-VU${__VU}`);
  }

  sleep(1);
}

declare const __VU: number;
declare const __ITER: number;
