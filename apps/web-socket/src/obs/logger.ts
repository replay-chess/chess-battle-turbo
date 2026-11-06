// Structured JSON logs (phase-02 plan 10.2): one line per entry with `game`, `ply`, `user`, `phase` fields, never
// emails or tokens. Errors also go to Sentry (game ref and op as tags only; no payloads).
import { createConsoleLogger, type LogFields, type Logger } from "../ports";

export interface LoggerOptions {
  level?: "debug" | "info" | "warn" | "error";
  base?: LogFields;
  /** Called for every `error` entry (src/obs/sentry.ts `reportError`). */
  onError?: (message: string, fields: LogFields | undefined, error: unknown) => void;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const consoleLogger = createConsoleLogger({
    ...(options.level ? { level: options.level } : {}),
    ...(options.base ? { base: options.base } : {}),
  });
  if (!options.onError) return consoleLogger;
  const onError = options.onError;
  return {
    debug: consoleLogger.debug,
    info: consoleLogger.info,
    warn: consoleLogger.warn,
    error(message, fields, error) {
      consoleLogger.error(message, fields, error);
      try {
        onError(message, fields, error);
      } catch {
        // reporting must never break the caller
      }
    },
  };
}
