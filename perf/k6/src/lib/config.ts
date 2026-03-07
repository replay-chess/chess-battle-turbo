// k6 env vars are accessed via __ENV (injected at runtime)
declare const __ENV: Record<string, string>;

export const CONFIG = {
  // URLs
  WEB_APP_URL: __ENV.WEB_APP_URL || 'https://chess-battle-perf.vercel.app',
  WS_URL: __ENV.WS_URL || 'wss://ws-perf.playchess.tech',

  // Game settings
  INITIAL_TIME_SECONDS: 60,
  INCREMENT_SECONDS: 0,
  GAME_MODE: 'friend' as const,
  MIN_MOVES: 10,

  // Timing
  THINK_TIME_MIN_MS: 300,
  THINK_TIME_MAX_MS: 1000,
  ANALYSIS_WAIT_TIMEOUT_MS: 45_000,
  GAME_START_TIMEOUT_MS: 60_000,
  MOVE_RESPONSE_TIMEOUT_MS: 10_000,
  WS_CONNECT_TIMEOUT_MS: 10_000,

  // Matchmaking
  MATCH_POLL_INTERVAL_MS: 2000,
  MATCH_POLL_MAX_ATTEMPTS: 30,

  // Tournament
  TOURNAMENT_DURATION_MINUTES: 30,
  TOURNAMENT_MAX_PARTICIPANTS: 100,
  TOURNAMENT_FIND_MATCH_STAGGER_MS: 300,
};

export function randomThinkTime(): number {
  return (
    CONFIG.THINK_TIME_MIN_MS +
    Math.random() * (CONFIG.THINK_TIME_MAX_MS - CONFIG.THINK_TIME_MIN_MS)
  );
}

export function wsUrl(): string {
  const base = CONFIG.WS_URL.replace('wss://', 'wss://').replace('ws://', 'ws://');
  return `${base}/socket.io/?EIO=4&transport=websocket`;
}

export function apiUrl(path: string): string {
  return `${CONFIG.WEB_APP_URL}${path}`;
}
