// @repo/analytics: the one event registry (phase-01 plan §10.1, CT X6).
//
// Every PostHog event is declared once in src/events/<area>.ts as a strict zod
// schema. Client helpers (`trackShell`, `trackSystem`, later `track`) import the
// TYPES from here only (`import type { EventProps } from "@repo/analytics"`), so
// zod never reaches the browser bundle. The schemas are parsed in Node by the
// e2e telemetry fixture (apps/web/e2e/fixtures/telemetry.ts).
//
// Adding a phase's events: create src/events/<area>.ts, spread it into EVENTS
// below, and add its test beside it.
import { z } from "zod";
import { accountsClientEvents, accountsEvents, accountsServerEvents } from "./events/accounts";
import { billingClientEvents, billingEvents, billingServerEvents } from "./events/billing";
import { gameClientEvents, gameEvents, gameServerEvents, gameSocketEvents } from "./events/game";
import { importEvents, importServerEvents } from "./events/import";
import { onboardingClientEvents, onboardingEvents, onboardingServerEvents } from "./events/onboarding";
import { reviewClientEvents, reviewEvents, reviewServerEvents } from "./events/review";
import { shellEvents } from "./events/shell";
import { systemClientEvents, systemEvents, systemServerEvents } from "./events/system";

export { shellEvents, DESTINATION_KEYS, NAV_SURFACES, ACCOUNT_ACTIONS } from "./events/shell";
export { systemEvents, systemClientEvents, systemServerEvents } from "./events/system";
export { gameEvents, gameClientEvents, gameServerEvents, gameSocketEvents, GAME_OVER_CTAS, END_METHODS, GAME_PHASES } from "./events/game";
export { reviewEvents, reviewClientEvents, reviewServerEvents, bucket10, countBucketOf, COUNT_BUCKETS } from "./events/review";
export { billingEvents, billingClientEvents, billingServerEvents, CHECKOUT_EVENT_SOURCES, checkoutStatusParam } from "./events/billing";
export { onboardingEvents, onboardingClientEvents, onboardingServerEvents } from "./events/onboarding";
export { accountsEvents, accountsClientEvents, accountsServerEvents, CONNECTED_BOARD_STATES } from "./events/accounts";
export { importEvents, importServerEvents, IMPORT_EVENT_CODES, IMPORT_EVENT_PROVIDERS, IMPORT_EVENT_TRIGGERS } from "./events/import";
export { FORBIDDEN_PROPERTY_NAMES, PII_PATTERNS, findPii, type PiiFinding } from "./pii";

export const EVENTS = {
  ...shellEvents,
  ...systemEvents,
  ...gameEvents,
  ...reviewEvents,
  ...billingEvents,
  ...onboardingEvents,
  ...accountsEvents,
  ...importEvents,
} as const;

export type Events = typeof EVENTS;
export type EventName = keyof Events;
export type EventProps<N extends EventName> = z.infer<Events[N]>;
export type ShellEventName = keyof typeof shellEvents;
export type SystemClientEventName = keyof typeof systemClientEvents;
export type SystemServerEventName = keyof typeof systemServerEvents;
export type GameClientEventName = keyof typeof gameClientEvents;
export type GameServerEventName = keyof typeof gameServerEvents;
export type GameSocketEventName = keyof typeof gameSocketEvents;
export type ReviewClientEventName = keyof typeof reviewClientEvents;
export type ReviewServerEventName = keyof typeof reviewServerEvents;
export type BillingClientEventName = keyof typeof billingClientEvents;
export type BillingServerEventName = keyof typeof billingServerEvents;
export type OnboardingClientEventName = keyof typeof onboardingClientEvents;
export type OnboardingServerEventName = keyof typeof onboardingServerEvents;
export type AccountsClientEventName = keyof typeof accountsClientEvents;
export type AccountsServerEventName = keyof typeof accountsServerEvents;
export type ImportServerEventName = keyof typeof importServerEvents;

/** Super properties PostHog adds to every event (set from NEXT_PUBLIC_APP_ENV). */
export const COMMON_PROPERTIES = z
  .object({ app_env: z.enum(["local", "dev", "test", "production"]) })
  .partial()
  .strict();

export const COMMON_PROPERTY_NAMES = Object.keys(COMMON_PROPERTIES.shape) as Array<
  keyof typeof COMMON_PROPERTIES.shape
>;

export function isEventName(name: string): name is EventName {
  return Object.prototype.hasOwnProperty.call(EVENTS, name);
}

/** Property names declared by an event's schema. */
export function declaredProperties(name: EventName): string[] {
  return Object.keys(EVENTS[name].shape);
}

export type ParseResult = { ok: true } | { ok: false; error: string };

/**
 * Validates one captured event against the registry. PostHog's own `$`-prefixed
 * properties and the common super properties are removed first; everything
 * else must match the event's strict schema exactly.
 */
export function parseEvent(name: string, props: Record<string, unknown> | null | undefined): ParseResult {
  if (!isEventName(name)) return { ok: false, error: `unregistered event "${name}"` };
  const own: Record<string, unknown> = {};
  const common: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (key.startsWith("$")) continue;
    if ((COMMON_PROPERTY_NAMES as string[]).includes(key)) common[key] = value;
    else own[key] = value;
  }
  const commonResult = COMMON_PROPERTIES.safeParse(common);
  if (!commonResult.success) return { ok: false, error: `${name}: ${z.prettifyError(commonResult.error)}` };
  const result = EVENTS[name].safeParse(own);
  if (!result.success) return { ok: false, error: `${name}: ${z.prettifyError(result.error)}` };
  return { ok: true };
}
