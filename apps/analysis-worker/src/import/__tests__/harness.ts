// The import integration harness (phase-04 plan §12.2): a real Postgres (testing/pg.ts: private `jobs` copy, the
// worker role when TEST_WORKER_DATABASE_URL is set), the in-process upstream (upstream.ts) behind the worker's real
// provider clients and gates, a FakeClock for every provider timing (gate pauses, timeouts, event cadence), and the
// real runner + IMPORT_SYNC handler. Fixture writes (members, links, runs, jobs) run as the database owner.
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY, type ImportTriggerDb, type JobKind } from "@repo/contracts/internal/jobs";
import { newGameRef } from "@repo/db/games";
import { CountingDb, pgDriver, type Driver, type Row, type Statement } from "../../db/client";
import { importSyncHandler } from "../../jobs/import-sync";
import { runJob, type HandlerMap, type RunResult } from "../../jobs/runner";
import { silentLogger } from "../../obs/log";
import { Metrics } from "../../obs/metrics";
import { RecordingProductEvents } from "../../obs/posthog";
import { RecordingTelemetry } from "../../obs/telemetry";
import { createProviders, type ImportProviders } from "../../providers";
import { claimJob, type ClaimedJob } from "../../queue/claim";
import { FakeClock } from "../../scheduler/clock";
import { RecordingEmitter } from "../../socket/emit";
import { insertJob, makeUser, type IntEnv, type TestUser } from "../../testing/pg";
import { defaultImportSettings, type ImportSettings } from "../settings";
import { CHESSCOM_BASE, FakeUpstream, LICHESS_BASE } from "./upstream";

/** The import tests' "now": inside the fixture games' 12-month window (they end Aug–Oct 2026). */
export const IMPORT_T0 = Date.UTC(2026, 10, 12, 9, 30, 0);
export const DAY_MS = 86_400_000;

export type MemberKind = "trial" | "paying" | "none";

/**
 * A Driver that records every statement text it sends, can run a hook before a call, and can lose the response of
 * calls `loseAfterCommit` accepts: the server commits, then the client sees `fetch failed` (ECONNRESET), as when the
 * Neon HTTP driver loses a response (P3-D11; CountingDb then resends once).
 */
export function recordingDriver(url: string) {
  const inner = pgDriver(url);
  const sent: string[] = [];
  const driver: Driver & {
    sent: string[];
    lost: string[];
    beforeRun: ((ss: readonly Statement[]) => Promise<void>) | null;
    loseAfterCommit: ((ss: readonly Statement[]) => boolean) | null;
  } = {
    sent,
    lost: [],
    beforeRun: null,
    loseAfterCommit: null,
    async run(ss, tx) {
      if (driver.beforeRun) await driver.beforeRun(ss);
      for (const s of ss) sent.push(s.text);
      const out = await inner.run(ss, tx);
      if (driver.loseAfterCommit?.(ss)) {
        driver.lost.push(ss.map((s) => s.text.slice(0, 40)).join(" | "));
        throw Object.assign(new Error("fetch failed"), { code: "ECONNRESET" });
      }
      return out;
    },
    close: () => inner.close(),
  };
  return driver;
}

/** A one-shot `loseAfterCommit` for the first call `match` accepts. */
export function loseOnce(match: (ss: readonly Statement[]) => boolean): (ss: readonly Statement[]) => boolean {
  let done = false;
  return (ss) => {
    if (done || !match(ss)) return false;
    done = true;
    return true;
  };
}

/**
 * Pushes every queued import job of earlier tests out of reach (afterEach). A finished run reschedules its DAILY job
 * at the account's next sync time computed from the fake clock (IMPORT_T0 = 2026-11-12 09:30 UTC, + 1 day in some
 * tests): a real wall-clock time. Once the real clock passed it, the next test's `runNext()` claimed that leftover job
 * instead of its own, so these suites failed every evening after ~21:35 UTC (regression: import-int-wallclock-claim).
 */
export async function parkImportJobs(env: IntEnv): Promise<void> {
  await env.owner.query(
    `UPDATE ${env.schema}.jobs SET "runAt" = TIMESTAMP '2100-01-01 00:00:00'
      WHERE status = 'QUEUED' AND kind IN ('IMPORT_SYNC', 'IMPORT_PURGE')`,
  );
}

export class ImportWorld {
  readonly clock = new FakeClock(IMPORT_T0);
  readonly emitter = new RecordingEmitter();
  readonly upstream: FakeUpstream;
  readonly providers: ImportProviders;
  readonly settings: ImportSettings;
  readonly driver: ReturnType<typeof recordingDriver>;
  /**
   * The `application_name` of this world's connections: a test that kills them (import-sync 12) must kill only these.
   * Every int test file of the package runs at once, as the same role, so a role-wide kill also cut other files'
   * pools (CI 43462320611: smoke.int.test's booted worker died with "Connection terminated unexpectedly").
   */
  readonly appName: string;
  readonly db: CountingDb;
  readonly metrics: Metrics;
  readonly telemetry = new RecordingTelemetry();
  /** PostHog events (validated against the registry; refused ones land in `product.refused`). */
  readonly product = new RecordingProductEvents();
  readonly handlers: HandlerMap;

  constructor(
    readonly env: IntEnv,
    tag: string,
    settings: Partial<ImportSettings> = {},
  ) {
    this.upstream = new FakeUpstream(tag);
    this.settings = defaultImportSettings({ chesscomBaseUrl: CHESSCOM_BASE, lichessBaseUrl: LICHESS_BASE, ...settings });
    this.providers = createProviders({ settings: this.settings, clock: this.clock, fetch: this.upstream.fetch });
    this.appName = `rc_imp_${tag}`.slice(0, 60);
    const url = new URL(env.workerUrl);
    url.searchParams.set("application_name", this.appName);
    this.driver = recordingDriver(url.toString());
    this.db = new CountingDb(this.driver);
    this.metrics = new Metrics({ workerId: "imp", bootId: "00000001", version: "0", profile: "sf18-v1" }, this.clock.now());
    this.handlers = {
      IMPORT_SYNC: importSyncHandler({ providers: this.providers, settings: this.settings, events: this.product }),
    };
  }

  /** Accounts this world linked: `close()` turns their auto-import off, so no other file's worker boot sweeps them. */
  private readonly linked: string[] = [];

  async close(): Promise<void> {
    // linked_accounts lives in the shared public schema: an overdue auto-import account left behind is what the boot
    // backstop of a full-worker int test in another file picks up (FIX-1).
    if (this.linked.length > 0) {
      await this.env.owner.query(`UPDATE linked_accounts SET "autoImport" = false WHERE id = ANY($1::bigint[])`, [this.linked]);
    }
    await this.db.close();
  }

  // ── fixtures (as the owner) ──────────────────────────────────────────────────────────────────────────────────────
  async member(kind: MemberKind, label: string, timeZone = "Asia/Kolkata"): Promise<TestUser> {
    const u = await makeUser(this.env.owner, label);
    const now = new Date(IMPORT_T0);
    const status = kind === "none" ? null : "active";
    const trialStart = kind === "trial" ? new Date(IMPORT_T0 - DAY_MS) : kind === "paying" ? new Date(IMPORT_T0 - 40 * DAY_MS) : null;
    const trialEnd = kind === "trial" ? new Date(IMPORT_T0 + 6 * DAY_MS) : kind === "paying" ? new Date(IMPORT_T0 - 33 * DAY_MS) : null;
    await this.env.owner.query(
      `UPDATE users SET "subscriptionStatus" = $2, "currentPeriodEnd" = $3, "trialStartedAt" = $4, "trialEndsAt" = $5,
              "timeZone" = $6 WHERE id = $1`,
      [u.id, status, status ? new Date(now.getTime() + 30 * DAY_MS) : null, trialStart, trialEnd, timeZone],
    );
    return u;
  }

  async link(
    user: TestUser,
    provider: "CHESSCOM" | "LICHESS",
    username: string,
    opts: { autoImport?: boolean } = {},
  ): Promise<string> {
    const { rows } = await this.env.owner.query<{ id: string }>(
      `INSERT INTO linked_accounts ("userId", provider, "externalId", username, "usernameLower", "autoImport", "updatedAt")
       VALUES ($1, $2::"ChessProvider", $3, $4, $5, $6, now()) RETURNING id::text AS id`,
      [user.id, provider, username.toLowerCase(), username, username.toLowerCase(), opts.autoImport ?? true],
    );
    this.linked.push(rows[0]!.id);
    return rows[0]!.id;
  }

  async run(user: TestUser, linkId: string, provider: "CHESSCOM" | "LICHESS", trigger: ImportTriggerDb): Promise<{ id: string; ref: string }> {
    const ref = newGameRef(Date.now());
    const { rows } = await this.env.owner.query<{ id: string }>(
      `INSERT INTO import_runs ("referenceId", "userId", "linkedAccountId", provider, trigger, status, "updatedAt")
       VALUES ($1, $2, $3, $4::"ChessProvider", $5::"ImportTrigger", 'QUEUED', now()) RETURNING id::text AS id`,
      [ref, user.id, linkId, provider, trigger],
    );
    return { id: rows[0]!.id, ref };
  }

  /** The account's one IMPORT_SYNC row (`import:<id>`), due now. */
  async job(linkId: string, runId: string | null, trigger: ImportTriggerDb): Promise<string> {
    const priority =
      trigger === "INITIAL" ? JOB_PRIORITY.IMPORT_SYNC_INITIAL : trigger === "DAILY" ? JOB_PRIORITY.IMPORT_SYNC_DAILY : JOB_PRIORITY.IMPORT_SYNC_MANUAL;
    return insertJob(this.env, {
      kind: "IMPORT_SYNC",
      priority,
      payload: { v: 1, linkedAccountId: linkId, runId, trigger },
      dedupeKey: `import:${linkId}`,
      maxAttempts: JOB_MAX_ATTEMPTS.IMPORT_SYNC,
    });
  }

  /** Makes a QUEUED job due now (its back-off or daily slot is in the future). */
  async due(jobId: string): Promise<void> {
    await this.env.owner.query(
      `UPDATE ${this.env.schema}.jobs SET "runAt" = (now() AT TIME ZONE 'UTC') - interval '1 second' WHERE id = $1`,
      [jobId],
    );
  }

  // ── running ────────────────────────────────────────────────────────────────────────────────────────────────────
  async claim(me: string, kinds: readonly JobKind[] = ["IMPORT_SYNC"]): Promise<ClaimedJob | null> {
    return claimJob(this.db, me, kinds, 1);
  }

  runClaimed(job: ClaimedJob, me: string, opts: { stop?: AbortSignal; db?: CountingDb } = {}): Promise<RunResult> {
    return runJob(job, {
      db: opts.db ?? this.db,
      clock: this.clock,
      log: silentLogger,
      metrics: this.metrics,
      telemetry: this.telemetry,
      emitter: this.emitter,
      me,
      appEnv: "test",
      handlers: this.handlers,
      engine: null,
      evalCache: null,
      evalCacheMaxBytes: 0,
      lag: null,
      stopSignal: opts.stop ?? new AbortController().signal,
      isWatched: () => false,
      takeFault: () => null,
      wakeEngine: () => void this.engineWakes++,
    });
  }

  /** How many times a job of this world woke the engine lane in-process (D1). */
  engineWakes = 0;

  /** Claims the next due import job as `me` and runs it. */
  async runNext(me = "imp-worker-0000aai1"): Promise<RunResult> {
    const job = await this.claim(me);
    if (!job) throw new Error("no import job is due");
    return this.runClaimed(job, me);
  }

  // ── reading back (as the owner) ─────────────────────────────────────────────────────────────────────────────────
  async q<T extends Row = Row>(text: string, values: unknown[] = []): Promise<T[]> {
    return (await this.env.owner.query(text, values)).rows as T[];
  }

  importEvents() {
    return this.emitter.sent.filter((e) => e.event.startsWith("import:"));
  }
}
