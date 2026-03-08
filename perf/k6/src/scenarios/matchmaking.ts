/**
 * Matchmaking Stress Test — 200 VUs hitting the matchmaking queue.
 *
 * Each VU creates a match request, polls for a match, then plays the game.
 * This stresses the `FOR UPDATE SKIP LOCKED` matchmaking query.
 *
 * VU pairing: VU 0 creates request, VU 1 creates request -> they match.
 * Even VUs queue first, odd VUs queue 300ms later.
 *
 * Usage:
 *   k6 run dist/matchmaking.js
 *   k6 run dist/matchmaking.js --vus 50
 */

import { check, sleep } from 'k6';
import { Options } from 'k6/options';
import http from 'k6/http';
import { SharedArray } from 'k6/data';

import { CONFIG, apiUrl } from '../lib/config';
import { playGame } from '../lib/game-player';
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

export const options: Options = {
  scenarios: {
    matchmaking: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 100 },
        { duration: '1m', target: 200 },
        { duration: '3m', target: 200 },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_error_rate: ['rate<0.1'],
    matchmaking_match_rate: ['rate>0.8'],
    game_completion_rate: ['rate>0.8'],
  },
};

export default function () {
  const userIndex = (__VU - 1) % users.length;
  const user = users[userIndex] as TestUser;
  const iterStart = Date.now();

  console.log(`[matchmaking] VU ${__VU} iter ${__ITER}: Starting — user=${user.referenceId.substring(0, 8)}, isEven=${__VU % 2 === 0}`);

  // Odd-indexed VUs wait slightly to let their partner queue first
  if (__VU % 2 === 0) {
    console.log(`[matchmaking] VU ${__VU}: Staggering 300ms (even VU, letting odd partner queue first)`);
    sleep(0.3);
  }

  // Create match request
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
    console.error(`[matchmaking] VU ${__VU}: queue FAILED — status=${queueRes.status}, duration=${queueRes.timings.duration}ms`);
    console.error(`[matchmaking] VU ${__VU}: Response: ${(queueRes.body as string)?.substring(0, 300)}`);
    sleep(2);
    return;
  }
  httpErrorRate.add(0);

  const queueBody = JSON.parse(queueRes.body as string);
  const queueEntry = queueBody.data.queueEntry;
  const queueRefId = queueEntry?.referenceId as string;
  const initialStatus = queueEntry?.status;

  console.log(`[matchmaking] VU ${__VU}: Queued — ref=${queueRefId?.substring(0, 8)}, status=${initialStatus}, took=${queueRes.timings.duration}ms`);

  // Check for immediate match — when matched immediately, gameReferenceId is in data.immediateMatch
  let gameRefId: string | null = null;
  if (initialStatus === 'MATCHED' && queueBody.data.immediateMatch?.gameReferenceId) {
    gameRefId = queueBody.data.immediateMatch.gameReferenceId;
    console.log(`[matchmaking] VU ${__VU}: INSTANT MATCH — gameRef=${gameRefId.substring(0, 8)}`);
  }

  // Poll for match if not immediately matched
  let pollCount = 0;
  let lastStatus = initialStatus;
  if (!gameRefId) {
    console.log(`[matchmaking] VU ${__VU}: Polling for match (max ${CONFIG.MATCH_POLL_MAX_ATTEMPTS} attempts, ${CONFIG.MATCH_POLL_INTERVAL_MS}ms interval)`);

    for (let i = 0; i < CONFIG.MATCH_POLL_MAX_ATTEMPTS; i++) {
      sleep(CONFIG.MATCH_POLL_INTERVAL_MS / 1000);
      pollCount++;

      const statusRes = http.get(
        apiUrl(`/api/matchmaking/match-status?referenceId=${queueRefId}`),
        { tags: { name: 'matchmaking-poll' } },
      );

      if (statusRes.status !== 200) {
        console.error(`[matchmaking] VU ${__VU}: Poll #${pollCount} — HTTP ${statusRes.status}`);
        continue;
      }

      const statusBody = JSON.parse(statusRes.body as string);
      const status = statusBody.data?.status;

      if (status !== lastStatus) {
        console.log(`[matchmaking] VU ${__VU}: Poll #${pollCount} — status changed: ${lastStatus} → ${status}`);
        lastStatus = status;
      }

      if (status === 'MATCHED' && statusBody.data?.matchedGameRef) {
        gameRefId = statusBody.data.matchedGameRef;
        console.log(`[matchmaking] VU ${__VU}: MATCHED after ${pollCount} polls — gameRef=${gameRefId!.substring(0, 8)}`);
        break;
      }

      if (status === 'EXPIRED') {
        console.log(`[matchmaking] VU ${__VU}: Queue entry EXPIRED after ${pollCount} polls`);
        break;
      }

      if (status === 'CANCELLED') {
        console.log(`[matchmaking] VU ${__VU}: Queue entry CANCELLED after ${pollCount} polls`);
        break;
      }
    }
  }

  matchmakingPollCount.add(pollCount);

  if (!gameRefId) {
    matchmakingMatchRate.add(false);
    const elapsed = Date.now() - iterStart;
    console.error(`[matchmaking] VU ${__VU}: NO MATCH — lastStatus=${lastStatus}, polls=${pollCount}, elapsed=${elapsed}ms`);
    sleep(1);
    return;
  }

  matchmakingMatchRate.add(true);

  // We got matched — but only one side of the pair should play the game
  // (the game needs both WS connections from one VU).
  // For matchmaking, odd VUs play the game, even VUs just confirm the match.
  if (__VU % 2 === 1) {
    const opponentIndex = userIndex % 2 === 0 ? userIndex + 1 : userIndex - 1;
    const opponent = users[opponentIndex] as TestUser;

    console.log(`[matchmaking] VU ${__VU}: Playing game — opponent=${opponent.referenceId.substring(0, 8)}`);
    playGame(gameRefId, user.referenceId, opponent.referenceId, `mm-VU${__VU}`);
  } else {
    console.log(`[matchmaking] VU ${__VU}: Even VU, skipping game play (partner VU plays)`);
  }

  sleep(1);
}

declare const __VU: number;
declare const __ITER: number;
