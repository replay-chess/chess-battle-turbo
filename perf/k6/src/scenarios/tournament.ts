/**
 * Tournament Test — Realistic concurrent join + continuous play.
 *
 * Simulates real-world tournament behavior:
 *   setup()    — admin creates tournament (1 request)
 *   default()  — Phase 1: all VUs join concurrently (thundering herd, like sharing a link)
 *                VU 1 waits for joins to settle, then starts the tournament
 *                Phase 2: all VUs loop: find-match → play → find-match → play...
 *                         until tournament clock expires
 *   teardown() — admin ends tournament, logs final standings
 *
 * Each VU acts as ONE independent player. Uses `constant-vus` executor
 * so VUs loop continuously for the full tournament duration.
 *
 * VU count must be EVEN (each game needs 2 players).
 *
 * Usage:
 *   k6 run dist/tournament.js                                       # 100 players, 15 min
 *   k6 run dist/tournament.js -e T_VUS=1000 -e T_DURATION=15       # 1000 players, 15 min
 *   k6 run dist/tournament.js -e T_VUS=1000 -e T_JOIN_WINDOW=120   # 2 min join window
 */

import { check, sleep } from 'k6';
import { Options } from 'k6/options';
import http from 'k6/http';
import { SharedArray } from 'k6/data';

import { CONFIG, apiUrl } from '../lib/config';
import { playSolo } from '../lib/solo-player';
import {
  httpErrorRate,
  tournamentGamesPlayed,
  tournamentJoinDuration,
  tournamentFindMatchDuration,
  tournamentMatchRate,
  tournamentFindMatchPolls,
  gameCompletionRate,
  wsConnectionSuccess,
  wsMoveDuration,
} from '../lib/metrics';
import { TestUser } from '../lib/user-pool';

const users = new SharedArray('users', function () {
  return JSON.parse(open('../setup/user-manifest.json')) as TestUser[];
});

const vuCount = parseInt(__ENV.T_VUS || '100', 10);
const tournamentDuration = parseInt(__ENV.T_DURATION || '15', 10);
// Join window: how long VUs have to join before VU1 starts the tournament.
// All VUs spread their join across this window (random delay 0..joinWindow).
// Must be long enough for all concurrent joins to complete.
const joinWindowSeconds = parseInt(__ENV.T_JOIN_WINDOW || '90', 10);
// Stagger for find-match: spread initial match-finding over this many seconds
// to avoid 1000 VUs all calling find-match at the exact same moment.
const matchStaggerSeconds = parseInt(__ENV.T_MATCH_STAGGER || '30', 10);

// Duration: join window + tournament + 3 min buffer for last games
const scenarioDuration = `${Math.ceil(joinWindowSeconds / 60) + tournamentDuration + 3}m`;

const jsonHeaders = { headers: { 'Content-Type': 'application/json' } };

export const options: Options = {
  scenarios: {
    tournament: {
      executor: 'constant-vus',
      vus: vuCount,
      duration: scenarioDuration,
    },
  },
  thresholds: {
    http_error_rate: ['rate<0.10'],
    tournament_match_rate: ['rate>0.70'],
    game_completion_rate: ['rate>0.70'],
    ws_move_duration: ['p(95)<1000'],
    ws_connection_success: ['rate>0.90'],
  },
};

interface SetupData {
  tournamentRefId: string;
  adminRefId: string;
}

// Per-VU mutable state (each VU has its own JS runtime)
let hasJoined = false;
let tournamentStarted = false;
let tournamentEnded = false;
let tournamentStartTime = 0; // epoch ms when tournament became ACTIVE

// If T_EXISTING_TOURNAMENT is set, skip create — join an existing tournament instead.
const existingTournamentId = __ENV.T_EXISTING_TOURNAMENT || '';

/**
 * setup() — admin creates the tournament (or uses an existing one).
 * Joining and starting happen concurrently in default().
 */
export function setup(): SetupData {
  const admin = users[0] as TestUser;

  if (existingTournamentId) {
    console.log(`[setup] Using existing tournament: ${existingTournamentId}`);
    return { tournamentRefId: existingTournamentId, adminRefId: admin.referenceId };
  }

  console.log(`[setup] Creating ${tournamentDuration}min tournament for ${vuCount} players`);
  console.log(`[setup] Join window: ${joinWindowSeconds}s, match stagger: ${matchStaggerSeconds}s`);

  const createRes = http.post(
    apiUrl('/api/tournament/create'),
    JSON.stringify({
      userReferenceId: admin.referenceId,
      name: `PerfTest-${tournamentDuration}m-${vuCount}p-${Date.now()}`,
      description: 'k6 performance test tournament',
      mode: 'FREE',
      durationMinutes: tournamentDuration,
      initialTimeSeconds: CONFIG.INITIAL_TIME_SECONDS,
      incrementSeconds: CONFIG.INCREMENT_SECONDS,
      maxParticipants: null,
      scheduledStartAt: new Date().toISOString(),
    }),
    { ...jsonHeaders, tags: { name: 'tournament-create' } },
  );

  if (!check(createRes, { 'create 201': (r) => r.status === 201 })) {
    console.error(`[setup] CREATE FAILED — status=${createRes.status}, body=${createRes.body}`);
    return { tournamentRefId: '', adminRefId: admin.referenceId };
  }

  const tournamentRefId = JSON.parse(createRes.body as string).data.referenceId;
  console.log(`[setup] Tournament created: ${tournamentRefId} (LOBBY)`);

  return { tournamentRefId, adminRefId: admin.referenceId };
}

/**
 * default() — two phases per VU:
 *
 * Phase 1 (first iteration): Join the tournament concurrently with all other VUs.
 *   - Each VU waits a small random delay (0..joinWindow), then POSTs join.
 *   - VU 1 is the "admin": after waiting the full join window, it starts the tournament.
 *   - All other VUs poll until the tournament is ACTIVE.
 *
 * Phase 2 (all subsequent iterations): Find match → play → repeat.
 */
export default function (data: SetupData) {
  if (!data.tournamentRefId || tournamentEnded) {
    sleep(5);
    return;
  }

  const userIndex = (__VU - 1) % users.length;
  const user = users[userIndex] as TestUser;
  const tag = `t-VU${__VU}-g${__ITER}`;
  const isAdmin = __VU === 1;

  // ═══════════════════════════════════════════
  // Phase 1: Join (first iteration only)
  // ═══════════════════════════════════════════
  if (!hasJoined) {
    // Spread joins across the join window (random delay simulates users clicking a link)
    const joinDelay = Math.random() * joinWindowSeconds * 0.7; // Use 70% of window for joins
    sleep(joinDelay);

    // Retry join up to 3 times (Vercel may timeout under thundering herd)
    let joined = false;
    for (let attempt = 0; attempt < 3 && !joined; attempt++) {
      if (attempt > 0) sleep(2 + Math.random() * 3);

      const joinRes = http.post(
        apiUrl('/api/tournament/join'),
        JSON.stringify({
          userReferenceId: user.referenceId,
          tournamentReferenceId: data.tournamentRefId,
        }),
        { ...jsonHeaders, tags: { name: 'tournament-join' } },
      );

      tournamentJoinDuration.add(joinRes.timings.duration);

      if (joinRes.status === 201 || joinRes.status === 200) {
        joined = true;
        httpErrorRate.add(0);
      } else if (joinRes.status === 0) {
        // Request timeout — Vercel overwhelmed, retry
        console.log(`[${tag}] Join timeout (attempt ${attempt + 1}/3), retrying...`);
        httpErrorRate.add(1);
      } else if (joinRes.status === 400) {
        // Tournament already ACTIVE — our timed-out request may have actually succeeded
        // server-side. Proceed as if joined; find-match will tell us if we're not a participant.
        const body = joinRes.body as string;
        if (body.includes('already started') || body.includes('Registration is closed')) {
          console.log(`[${tag}] Tournament already started, assuming join succeeded — proceeding to play`);
          joined = true;
        } else {
          console.error(`[${tag}] JOIN FAILED: status=400, body=${body}`);
          httpErrorRate.add(1);
        }
      } else {
        console.error(`[${tag}] JOIN FAILED: status=${joinRes.status}`);
        httpErrorRate.add(1);
      }
    }

    if (!joined) {
      console.error(`[${tag}] JOIN EXHAUSTED after 3 attempts — skipping this VU`);
      sleep(5);
      return;
    }
    hasJoined = true;

    // ─── Admin (VU 1): wait for join window to close, then start tournament ───
    if (isAdmin) {
      // Wait until the join window is fully over
      const remainingWait = joinWindowSeconds - joinDelay;
      if (remainingWait > 0) {
        console.log(`[${tag}] Admin waiting ${remainingWait.toFixed(0)}s for join window to close`);
        sleep(remainingWait);
      }

      console.log(`[${tag}] Admin starting tournament...`);
      const startRes = http.post(
        apiUrl('/api/tournament/start'),
        JSON.stringify({
          userReferenceId: user.referenceId,
          tournamentReferenceId: data.tournamentRefId,
        }),
        { ...jsonHeaders, tags: { name: 'tournament-start' } },
      );

      if (!check(startRes, { 'start 200': (r) => r.status === 200 })) {
        console.error(`[${tag}] START FAILED — status=${startRes.status}, body=${startRes.body}`);
        return;
      }

      const startData = JSON.parse(startRes.body as string).data;
      console.log(`[${tag}] Tournament ACTIVE — ends at ${startData.endsAt}`);
      tournamentStarted = true;
      tournamentStartTime = Date.now();
    } else {
      // ─── Non-admin VUs: wait for tournament to start ───
      // Instead of polling every 2s (which creates a thundering herd of 900+ VUs
      // hammering Vercel), just sleep until the join window is over.
      // VU1 starts the tournament after joinWindowSeconds, so we wait:
      //   joinWindowSeconds - joinDelay + 15s buffer
      // This eliminates ~450 req/s of status polling entirely.
      const remainingWait = joinWindowSeconds - joinDelay + 15;
      if (remainingWait > 0) {
        sleep(remainingWait);
      }
      // VU1 always starts the tournament after the join window.
      // Just assume it's started — find-match will tell us if it's not.
      tournamentStarted = true;
      tournamentStartTime = Date.now();
      console.log(`[${tag}] Join window elapsed — proceeding to play`);
    }

    // Stagger initial find-match calls
    const matchDelay = Math.random() * matchStaggerSeconds;
    sleep(matchDelay);
    return; // End this iteration — next iteration starts Phase 2
  }

  // ═══════════════════════════════════════════
  // Phase 2: Find match → Play → Repeat
  // ═══════════════════════════════════════════
  if (!tournamentStarted || tournamentEnded) {
    sleep(5);
    return;
  }

  // Stop finding new matches if less than 90s remain — not enough time for a full game
  const elapsedMs = Date.now() - tournamentStartTime;
  const remainingMs = (tournamentDuration * 60 * 1000) - elapsedMs;
  if (remainingMs < 90_000) {
    if (!tournamentEnded) {
      console.log(`[${tag}] <60s remaining, stopping — played ${__ITER - 1} games`);
      tournamentEnded = true;
    }
    sleep(5);
    return;
  }

  // ─── Find match ───
  let gameRefId: string | null = null;
  let pollCount = 0;
  const maxPolls = 60;

  for (let i = 0; i < maxPolls; i++) {
    if (tournamentEnded) return;

    const findRes = http.post(
      apiUrl('/api/tournament/find-match'),
      JSON.stringify({
        userReferenceId: user.referenceId,
        tournamentReferenceId: data.tournamentRefId,
      }),
      { ...jsonHeaders, tags: { name: 'tournament-find-match' } },
    );

    tournamentFindMatchDuration.add(findRes.timings.duration);
    pollCount++;

    if (findRes.status !== 200 && findRes.status !== 202) {
      const body = findRes.body as string;

      if (body.includes('not active') || body.includes('not a participant')) {
        if (!tournamentEnded) {
          console.log(`[${tag}] Tournament ended — played ${__ITER - 1} games`);
          tournamentEnded = true;
        }
        tournamentFindMatchPolls.add(pollCount);
        return;
      }

      httpErrorRate.add(1);
      sleep(2);
      continue;
    }
    httpErrorRate.add(0);

    const resBody = JSON.parse(findRes.body as string);
    const status = resBody.data?.status;

    if (status === 'MATCHED') {
      gameRefId = resBody.data.gameReferenceId;
      break;
    }

    if (status === 'IN_GAME') {
      gameRefId = resBody.data.gameReferenceId;
      break;
    }

    if (status === 'SEARCHING') {
      sleep(CONFIG.MATCH_POLL_INTERVAL_MS / 1000);
      continue;
    }

    sleep(2);
  }

  tournamentFindMatchPolls.add(pollCount);

  if (!gameRefId) {
    tournamentMatchRate.add(false);
    sleep(2);
    return;
  }

  tournamentMatchRate.add(true);

  // ─── Play ───
  // 60s timeout per game (enough for WS connect + analysis phase + 10 moves), capped by remaining tournament time
  const gameTimeout = Math.min(60_000, (tournamentDuration * 60 * 1000) - (Date.now() - tournamentStartTime));
  playSolo(gameRefId, user.referenceId, tag, Math.max(gameTimeout, 15_000));
  tournamentGamesPlayed.add(1);

  // Brief cooldown before next match
  sleep(1 + Math.random() * 2);
}

/**
 * teardown() — ends tournament and logs final standings.
 */
export function teardown(data: SetupData) {
  if (!data.tournamentRefId) return;

  const endRes = http.post(
    apiUrl('/api/tournament/end'),
    JSON.stringify({
      userReferenceId: data.adminRefId,
      tournamentReferenceId: data.tournamentRefId,
    }),
    { ...jsonHeaders, tags: { name: 'tournament-end' } },
  );

  if (endRes.status === 200) {
    console.log(`[teardown] Tournament ended successfully`);
  } else {
    console.log(`[teardown] End status=${endRes.status} (may have auto-completed)`);
  }

  const detailRes = http.get(
    apiUrl(`/api/tournament/${data.tournamentRefId}`),
    { tags: { name: 'tournament-detail' } },
  );

  if (detailRes.status === 200) {
    const detail = JSON.parse(detailRes.body as string).data;
    const participants = detail.participants || [];
    console.log(`[teardown] Final standings (${participants.length} players):`);

    const top = participants.slice(0, 10);
    for (let i = 0; i < top.length; i++) {
      const p = top[i];
      console.log(`  #${i + 1} ${p.user?.name || 'Unknown'}: ${p.points}pts (W${p.wins}/L${p.losses}/D${p.draws}, ${p.gamesPlayed} games)`);
    }
    if (participants.length > 10) {
      console.log(`  ... and ${participants.length - 10} more`);
    }
  }
}

declare const __VU: number;
declare const __ITER: number;
