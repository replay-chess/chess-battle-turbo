// One JSON line per event on stdout/stderr (docker logs). Fields are values the caller chose: never a URL with a
// password, a key or a user's name (refs and ids only, plan §10.2 "no names").
import type { LogLevel } from "../config/env";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function serialise(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, code: (value as { code?: unknown }).code };
  if (typeof value === "bigint") return value.toString();
  return value;
}

export function createLogger(
  level: LogLevel,
  base: LogFields = {},
  write: (line: string, level: LogLevel) => void = (line, lvl) =>
    (lvl === "error" || lvl === "warn" ? process.stderr : process.stdout).write(`${line}\n`),
): Logger {
  const min = RANK[level];
  const emit = (lvl: LogLevel, msg: string, fields?: LogFields) => {
    if (RANK[lvl] < min) return;
    const record: LogFields = { t: new Date().toISOString(), level: lvl, msg, ...base };
    for (const [k, v] of Object.entries(fields ?? {})) record[k] = serialise(v);
    write(JSON.stringify(record), lvl);
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => createLogger(level, { ...base, ...fields }, write),
  };
}

/** A logger that drops everything (unit tests). */
export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};
