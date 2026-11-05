# `@repo/analytics`

The one telemetry event registry (phase-01 plan §10.1, CT X6). Every PostHog event the web app, the socket server or a worker sends is declared here once, as a strict zod schema. The same schemas check the events in the e2e telemetry fixture, and the PII guard runs over every captured event.

## Layout

| File | What |
|---|---|
| `src/events/<area>.ts` | One file per area (`shell.ts`, `system.ts`). Each exports a map `{ event_name: z.strictObject({...}) }`. |
| `src/index.ts` | `EVENTS` (all areas spread), `EventName`, `EventProps<N>`, `COMMON_PROPERTIES`, `isEventName`, `declaredProperties`, `parseEvent` |
| `src/pii.ts` | `findPii(props)`, `PII_PATTERNS` (emails, FEN boards, PGN move runs, E2E user names), `FORBIDDEN_PROPERTY_NAMES` |
| `src/registry.test.ts`, `src/events/*.test.ts` | Unique names, strict schemas, no forbidden property names, PII cases |

## Sending events (sinks)

- **Client:** `trackShell()` (`apps/web/lib/analytics/shell-events.ts`) and `trackSystem()` (`apps/web/lib/analytics/system-events.ts`). They import only the **types** from this package, so zod never reaches the browser bundle.
- **Server:** posthog-node through the web app's server helpers (for example `captureWebhookProcessed` in `apps/web/lib/webhooks/record.ts`).
- **Tests:** test builds (`NEXT_PUBLIC_TELEMETRY_SINK=1`) push client events to `window.__rcTelemetry`; server events go to the local sink `apps/web/e2e/mocks/posthog-sink.ts` (`POSTHOG_HOST=http://127.0.0.1:4011`). The fixture `apps/web/e2e/fixtures/telemetry.ts` reads both, parses each event with its schema here (unknown events and extra keys fail) and runs `findPii` on it.

```ts
// client component
trackSystem("rate_limited_shown", { route_id: "health.get", bucket: "health-deep", retry_after_sec: 30, surface: "inline" });

// e2e spec
await telemetry.expect("rate_limited_shown", { surface: "inline" }, { source: "client", count: 1 });
telemetry.forbid("morphy"); // typed text must never be sent
```

## Adding a phase's events

1. Create `src/events/<area>.ts` with strict schemas. Use snake_case names and properties; never a free-text, email, FEN or PGN property.
2. Spread it into `EVENTS` in `src/index.ts` and add `src/events/<area>.test.ts`.
3. Add a typed client helper in `apps/web/lib/analytics/` if the area sends from the browser.

## Commands

```sh
pnpm --filter @repo/analytics test          # registry and PII tests
pnpm --filter @repo/analytics check-types
```
