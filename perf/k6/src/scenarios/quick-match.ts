/**
 * Quick Match Test — Realistic matchmaking simulation.
 *
 * Each VU acts as ONE independent player:
 *   1. POST /api/matchmaking/create-match-request  (enter queue)
 *   2. Poll GET /api/matchmaking/match-status       (wait for match)
 *   3. Connect ONE WebSocket, play as assigned color
 *   4. Resign after MIN_MOVES, wait for game_over
 *
 * The server's matchmaking engine pairs players via FOR UPDATE SKIP LOCKED.
 * No VU coordination — players are matched organically, just like production.
 *
 * IMPORTANT: VU count must be EVEN (each game needs 2 players).
 *
 * Usage:
 *   k6 run dist/quick-match.js                                # 100 players, 1 game each
 *   k6 run dist/quick-match.js -e QM_VUS=200 -e QM_GAMES=5   # 200 players, 5 games each
 *   k6 run dist/quick-match.js -e QM_STAGGER=120              # stagger over 2 min
 */

import { check, sleep } from 'k6';
import { Options } from 'k6/options';
import http from 'k6/http';
import { SharedArray } from 'k6/data';

import { CONFIG, apiUrl } from '../lib/config';
import { playSolo } from '../lib/solo-player';
import {
  httpMatchmakingDuration,
  httpErrorRate,
  matchmakingMatchRate,
  matchmakingPollCount,
} from '../lib/metrics';
import { TestUser } from '../lib/user-pool';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../setup/user-manifest.json')) as TestUser[];
});

const vuCount = parseInt(__ENV.QM_VUS || '100', 10);
const gamesPerVU = parseInt(__ENV.QM_GAMES || '1', 10);
const staggerSeconds = parseInt(__ENV.QM_STAGGER || '60', 10);

export const options: Options = {
  scenarios: {
    quick_match: {
      executor: 'per-vu-iterations',
      vus: vuCount,
      iterations: gamesPerVU,
      maxDuration: '30m',
    },
  },
  thresholds: {
    http_error_rate: ['rate<0.10'],
    matchmaking_match_rate: ['rate>0.80'],
    game_completion_rate: ['rate>0.80'],
    ws_move_duration: ['p(95)<1000'],
    ws_connection_success: ['rate>0.90'],
  },
};

export default function () {
  // Each VU gets a unique user (1 VU = 1 player, not a pair)
  const userIndex = (__VU - 1) % users.length;
  const user = users[userIndex] as TestUser;
  const tag = `qm-VU${__VU}-i${__ITER}`;

  // Stagger first iteration to avoid thundering herd
  if (__ITER === 0) {
    const delay = Math.random() * staggerSeconds;
    sleep(delay);
  }

  // ─── Phase 1: Enter matchmaking queue ───
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

    // Handle "already has active queue entry" — wait and retry
    const body = queueRes.body as string;
    if (queueRes.status === 409) {
      console.log(`[${tag}] Already in queue, waiting 5s before retry`);
      sleep(5);
      return;
    }

    console.error(`[${tag}] queue FAILED — status=${queueRes.status}`);
    sleep(3);
    return;
  }
  httpErrorRate.add(0);

  const queueBody = JSON.parse(queueRes.body as string);
  const initialStatus = queueBody.data?.queueEntry?.status || queueBody.data?.status;
  const queueRefId = queueBody.data?.queueEntry?.referenceId || queueBody.data?.referenceId;

  // ─── Phase 2: Check for immediate match ───
  let gameRefId: string | null = null;

  if (initialStatus === 'MATCHED') {
    gameRefId = queueBody.data?.immediateMatch?.gameReferenceId
      || queueBody.data?.gameReferenceId;
    if (gameRefId) {
      console.log(`[${tag}] INSTANT MATCH — gameRef=${gameRefId.substring(0, 8)}`);
    }
  }

  // ─── Phase 3: Poll for match if not instant ───
  let pollCount = 0;

  if (!gameRefId && queueRefId) {
    for (let i = 0; i < CONFIG.MATCH_POLL_MAX_ATTEMPTS; i++) {
      sleep(CONFIG.MATCH_POLL_INTERVAL_MS / 1000);
      pollCount++;

      const statusRes = http.get(
        apiUrl(`/api/matchmaking/match-status?referenceId=${queueRefId}&userReferenceId=${user.referenceId}`),
        { tags: { name: 'matchmaking-poll' } },
      );

      if (statusRes.status !== 200) continue;

      const statusBody = JSON.parse(statusRes.body as string);
      const status = statusBody.data?.status;

      if (status === 'MATCHED') {
        gameRefId = statusBody.data?.matchedGameRef
          || statusBody.data?.gameReferenceId;
        if (gameRefId) {
          console.log(`[${tag}] MATCHED after ${pollCount} polls — gameRef=${gameRefId.substring(0, 8)}`);
          break;
        }
      }

      if (status === 'EXPIRED' || status === 'CANCELLED') {
        console.log(`[${tag}] Queue ${status} after ${pollCount} polls`);
        break;
      }
    }
  }

  matchmakingPollCount.add(pollCount);

  if (!gameRefId) {
    matchmakingMatchRate.add(false);
    console.error(`[${tag}] NO MATCH — polls=${pollCount}`);
    sleep(1);
    return;
  }

  matchmakingMatchRate.add(true);

  // ─── Phase 4: Play the game (single WebSocket, my side only) ───
  playSolo(gameRefId, user.referenceId, tag);
}

declare const __VU: number;
declare const __ITER: number;
