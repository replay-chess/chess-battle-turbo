// k6 env vars are accessed via __ENV (injected at runtime)
declare const __ENV: Record<string, string>;

export const CONFIG = {
  // URLs
  WEB_APP_URL: __ENV.WEB_APP_URL || 'https://chess-battle-perf.vercel.app',
  WS_URL: __ENV.WS_URL || 'wss://ws-perf.playchess.tech',

  // Second secret for the server's PERF_AUTH_BYPASS (dev and test only; plan H9).
  // The server ignores the bypass unless x-perf-token equals its PERF_TOKEN.
  PERF_TOKEN: __ENV.PERF_TOKEN || '',

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

/** Headers every k6 request sends: the perf-bypass token (when set) plus `extra`. */
export function perfHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return CONFIG.PERF_TOKEN ? { 'x-perf-token': CONFIG.PERF_TOKEN, ...extra } : { ...extra };
}

/** JSON request params with the perf-bypass token, for `http.post(url, body, jsonParams(...))`. */
export function jsonParams(tags?: Record<string, string>): {
  headers: Record<string, string>;
  tags?: Record<string, string>;
} {
  return { headers: perfHeaders({ 'Content-Type': 'application/json' }), ...(tags ? { tags } : {}) };
}
