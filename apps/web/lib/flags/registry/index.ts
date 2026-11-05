// Flag registry (plan §7.10). Client-safe: imported by lib/flags/index.ts (server) and lib/flags/client.ts.
// Client code imports types and the pure helpers below; it never evaluates PostHog.

import { P01_FLAGS } from "./p01";

/** Every phase file, in phase order. `flags.test.ts` asserts no key appears in two of them. */
export const FLAG_REGISTRIES = { p01: P01_FLAGS /* , p02: P02_FLAGS (P2 adds one line here and one below) */ } as const;

export const FLAGS = { ...P01_FLAGS /* , ...P02_FLAGS */ } as const;

export type FlagKey = keyof typeof FLAGS;
export type FlagEnv = "dev" | "test" | "production" | "local";
export type FlagValues = Record<FlagKey, boolean>;

export const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[];

export function isFlagKey(key: string): key is FlagKey {
  return Object.prototype.hasOwnProperty.call(FLAGS, key);
}

/**
 * The column of `default` that applies. `NEXT_PUBLIC_APP_ENV` is "dev" | "test" | "production" on deployed
 * builds; unset is a local `next dev` (or a unit test). Fails closed: an unknown value, or unset in a
 * production Node build, reads the production column.
 */
export function flagEnv(
  appEnv: string | undefined = process.env.NEXT_PUBLIC_APP_ENV,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): FlagEnv {
  if (appEnv === "dev" || appEnv === "test" || appEnv === "production") return appEnv;
  if (!appEnv && nodeEnv !== "production") return "local";
  return "production";
}

export function defaultFlag(key: FlagKey, env: FlagEnv): boolean {
  return FLAGS[key].default[env];
}

export function defaultFlags(env: FlagEnv): FlagValues {
  const out = {} as FlagValues;
  for (const key of FLAG_KEYS) out[key] = defaultFlag(key, env);
  return out;
}

/**
 * The flag value a client reads from the viewer payload (`qk.me()` data, `MeData.flags`).
 * No viewer (signed out, or the cache not seeded yet) or a key the server did not ship → registry default.
 */
export function flagFromMe(
  me: { flags?: Record<string, boolean> | null } | null | undefined,
  key: FlagKey,
  env: FlagEnv,
): boolean {
  const value = me?.flags?.[key];
  return typeof value === "boolean" ? value : defaultFlag(key, env);
}
