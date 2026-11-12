// Telemetry fixture (phase-01 plan §10.1, CT X6).
//
// Client events: test builds with NEXT_PUBLIC_TELEMETRY_SINK=1 push
// `{ event, props, ts }` to `window.__rcTelemetry`. An init script mirrors those
// pushes into the test through a binding, so events survive navigations.
// Server events: posthog-node posts to e2e/mocks/posthog-sink.ts
// (POSTHOG_HOST=http://127.0.0.1:4011), which this fixture reads back.
//
//   test("palette", async ({ page, telemetry }) => {
//     await page.keyboard.press("Meta+K");
//     await telemetry.expect("shell_palette_opened", { via: "shortcut" });
//     telemetry.forbid("morphy");                     // typed text must never be sent
//     await telemetry.expect("webhook_processed", { outcome: "duplicate" }, { count: 1, source: "server" });
//   });
//
// After every test that used a page, each captured client event is parsed with
// its @repo/analytics schema (unknown events and extra keys fail) and run
// through the PII guard: emails, FEN boards, PGN move runs, the E2E users'
// names and emails, and every `forbid()` text fail the test. Tests that used
// the `telemetry` fixture get the same check on server events.
//
// When P11's consent gate lands, set the consent cookie here by default.
import { expect, type BrowserContext, type TestInfo } from "@playwright/test";
import { findPii, parseEvent } from "@repo/analytics";
import { test as guarded } from "./console-guard";
import { knownIdentities } from "./users";

export type CapturedEvent = {
  source: "client" | "server";
  event: string;
  props: Record<string, unknown>;
  ts: number;
  distinctId?: string | null;
  url?: string;
};

export type TelemetryOptions = {
  /** Base URL of the PostHog sink, or null to skip server events (dev URL runs). */
  telemetrySinkUrl: string | null;
  /** Parse and PII-check captured events after each test. */
  telemetryCheck: boolean;
};

type Recorder = { client: CapturedEvent[]; forbidden: string[]; since: number };

export type Match = Record<string, unknown>;
export type ExpectOptions = {
  count?: number;
  source?: "client" | "server" | "any";
  timeout?: number;
  /** Server events only from this `distinct_id` (the user ref): the sink is shared by every parallel test. */
  distinctId?: string;
};

export type Telemetry = {
  /** Waits until `name` was captured (exactly `count` times when given) with props containing `match`. */
  expect(name: string, match?: Match, options?: ExpectOptions): Promise<CapturedEvent[]>;
  /** Asserts `name` has not been captured during this test. */
  none(name: string, options?: Pick<ExpectOptions, "source">): Promise<void>;
  /** Registers text that must never appear in any property value (e.g. what the spec typed). */
  forbid(text: string): void;
  /** Every event captured so far in this test. */
  events(source?: "client" | "server" | "any"): Promise<CapturedEvent[]>;
};

const INIT_SCRIPT = `(() => {
  if (window.__rcTelemetryInstalled) return;
  window.__rcTelemetryInstalled = true;
  const record = (item) => { try { window.__rcTelemetryRecord && window.__rcTelemetryRecord(item); } catch (e) {} };
  const wrap = (a) => { const push = Array.prototype.push; a.push = function (...items) { items.forEach(record); return push.apply(this, items); }; return a; };
  let arr = wrap([]);
  Object.defineProperty(window, "__rcTelemetry", {
    configurable: true,
    get() { return arr; },
    set(v) { if (Array.isArray(v)) { v.forEach(record); arr = wrap(v); } },
  });
})();`;

/** True when every key of `match` equals the event's property (shallow). */
export function matchesProps(props: Record<string, unknown>, match: Match | undefined): boolean {
  if (!match) return true;
  return Object.entries(match).every(([k, v]) => JSON.stringify(props[k]) === JSON.stringify(v));
}

/** Registry and PII problems of a list of events (pure; exported for unit tests). */
export function auditEvents(events: CapturedEvent[], forbidden: readonly string[]): string[] {
  const problems: string[] = [];
  for (const e of events) {
    const parsed = parseEvent(e.event, e.props);
    if (!parsed.ok) problems.push(`[${e.source}] schema: ${parsed.error}`);
    for (const f of findPii(e.props, forbidden)) {
      problems.push(`[${e.source}] PII (${f.kind}) in ${e.event} ${f.path}: ${JSON.stringify(f.value).slice(0, 80)}`);
    }
  }
  return problems;
}

/** PostHog server bodies carry bookkeeping keys that are not event properties. */
const SERVER_BOOKKEEPING = new Set(["distinct_id", "token", "uuid", "timestamp"]);

async function fetchServerEvents(sinkUrl: string, since: number): Promise<CapturedEvent[] | null> {
  try {
    const res = await fetch(`${sinkUrl}/__events?since=${since}`, { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      events: Array<{ event: string; distinct_id: string | null; properties: Record<string, unknown>; receivedAt: number }>;
    };
    return body.events.map((e) => ({
      source: "server" as const,
      event: e.event,
      props: Object.fromEntries(Object.entries(e.properties).filter(([k]) => !SERVER_BOOKKEEPING.has(k))),
      ts: e.receivedAt,
      distinctId: e.distinct_id,
    }));
  } catch {
    return null;
  }
}

async function failOnProblems(problems: string[], testInfo: TestInfo, label: string) {
  if (!problems.length) return;
  await testInfo.attach(label, { body: problems.join("\n"), contentType: "text/plain" });
  if (testInfo.status === "passed" || testInfo.status === undefined) {
    throw new Error(`${label}: ${problems.length} problem(s)\n${problems.join("\n")}`);
  }
}

async function installClientSink(context: BrowserContext, recorder: Recorder) {
  await context.exposeBinding("__rcTelemetryRecord", (source, item: unknown) => {
    if (!item || typeof item !== "object") return;
    const e = item as { event?: unknown; props?: unknown; ts?: unknown };
    if (typeof e.event !== "string") return;
    recorder.client.push({
      source: "client",
      event: e.event,
      props: e.props && typeof e.props === "object" ? (e.props as Record<string, unknown>) : {},
      ts: typeof e.ts === "number" ? e.ts : Date.now(),
      url: source.page?.url(),
    });
  });
  await context.addInitScript({ content: INIT_SCRIPT });
}

export const test = guarded.extend<TelemetryOptions & { telemetry: Telemetry; _telemetryRecorder: Recorder }>({
  telemetrySinkUrl: [null, { option: true }],
  telemetryCheck: [true, { option: true }],
  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructuring pattern here
  _telemetryRecorder: async ({}, provide) => {
    await provide({ client: [], forbidden: knownIdentities(), since: Date.now() });
  },
  context: async ({ context, _telemetryRecorder, telemetryCheck }, provide, testInfo) => {
    await installClientSink(context, _telemetryRecorder);
    await provide(context);
    if (telemetryCheck) {
      await failOnProblems(
        auditEvents(_telemetryRecorder.client, _telemetryRecorder.forbidden),
        testInfo,
        "telemetry (client)",
      );
    }
  },
  telemetry: async ({ _telemetryRecorder: rec, telemetrySinkUrl, telemetryCheck }, provide, testInfo) => {
    const all = async (source: ExpectOptions["source"] = "any") => {
      const server =
        source !== "client" && telemetrySinkUrl ? ((await fetchServerEvents(telemetrySinkUrl, rec.since)) ?? []) : [];
      const client = source !== "server" ? rec.client : [];
      return [...client, ...server];
    };
    const api: Telemetry = {
      async expect(name, match, options = {}) {
        if (options.source === "server" && !telemetrySinkUrl) {
          throw new Error("telemetry.expect(source: server) needs the PostHog sink; tag the spec @local-only");
        }
        const find = async () =>
          (await all(options.source)).filter(
            (e) =>
              e.event === name &&
              matchesProps(e.props, match) &&
              (options.distinctId === undefined || e.distinctId === options.distinctId),
          );
        const poll = expect.poll(async () => (await find()).length, {
          timeout: options.timeout ?? 10_000,
          message: `telemetry event ${name} ${JSON.stringify(match ?? {})}`,
        });
        if (options.count === undefined) await poll.toBeGreaterThan(0);
        else await poll.toBe(options.count);
        return find();
      },
      async none(name, options = {}) {
        const found = (await all(options.source)).filter((e) => e.event === name);
        expect(found, `telemetry event ${name} must not be sent`).toHaveLength(0);
      },
      forbid(text) {
        rec.forbidden.push(text);
      },
      events: (source) => all(source),
    };
    await provide(api);
    if (telemetryCheck && telemetrySinkUrl) {
      const server = (await fetchServerEvents(telemetrySinkUrl, rec.since)) ?? [];
      await failOnProblems(auditEvents(server, rec.forbidden), testInfo, "telemetry (server)");
    }
  },
});

export { expect } from "@playwright/test";
