import * as Sentry from "@sentry/node";

// ============================================
// ERROR CAPTURE
// ============================================

export function captureSocketError(
  error: unknown,
  context: {
    event: string;
    gameReferenceId?: string;
    userReferenceId?: string;
    socketId?: string;
    extra?: Record<string, unknown>;
  }
): void {
  Sentry.withScope((scope) => {
    scope.setTag("socket.event", context.event);

    if (context.gameReferenceId) {
      scope.setTag("game.referenceId", context.gameReferenceId);
    }

    if (context.userReferenceId) {
      scope.setUser({ id: context.userReferenceId });
    }

    if (context.socketId) {
      scope.setTag("socket.id", context.socketId);
    }

    if (context.extra) {
      scope.setExtras(context.extra);
    }

    Sentry.captureException(error);
  });
}

// ============================================
// BREADCRUMBS
// ============================================

export function addGameBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = "info"
): void {
  Sentry.addBreadcrumb({
    category: "game",
    message,
    data,
    level,
  });
}

export function addApiBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = "info"
): void {
  Sentry.addBreadcrumb({
    category: "api",
    message,
    data,
    level,
  });
}

export function addSocketBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  level: Sentry.SeverityLevel = "info"
): void {
  Sentry.addBreadcrumb({
    category: "socket",
    message,
    data,
    level,
  });
}

// ============================================
// METRICS
// ============================================

export function trackActiveGames(count: number): void {
  Sentry.metrics.gauge("ws.active_games", count);
}

export function trackGameDuration(
  durationSeconds: number,
  attributes?: Record<string, string>
): void {
  Sentry.metrics.distribution("ws.game_duration", durationSeconds, {
    unit: "second",
    attributes,
  });
}

export function trackSocketEvent(
  eventName: string,
  attributes?: Record<string, string>
): void {
  Sentry.metrics.count("ws.socket_event", 1, {
    attributes: { event: eventName, ...attributes },
  });
}

export function trackActiveConnections(count: number): void {
  Sentry.metrics.gauge("ws.active_connections", count);
}

export function trackApiLatency(endpoint: string, durationMs: number): void {
  Sentry.metrics.distribution("ws.api_latency", durationMs, {
    unit: "millisecond",
    attributes: { endpoint },
  });
}

export function trackApiError(endpoint: string): void {
  Sentry.metrics.count("ws.api_error", 1, {
    attributes: { endpoint },
  });
}

// ============================================
// FLUSH
// ============================================

export async function flushSentry(timeoutMs: number = 2000): Promise<void> {
  await Sentry.close(timeoutMs);
}
