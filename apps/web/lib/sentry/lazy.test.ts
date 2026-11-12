// The lazily loaded Sentry SDK (FIX-2): no SDK without a DSN; calls made before it loads run once it has; a failed
// load drops them; nothing throws.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { loadedSentry, loadSentry, resetSentryForTests, withSentry } from "./lazy";

type Sdk = Awaited<ReturnType<typeof loadSentry>>;
const fake = (log: string[]) => ({ captureException: (e: unknown) => log.push(`exc:${String(e)}`) }) as unknown as NonNullable<Sdk>;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("lazy Sentry", () => {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  afterEach(() => {
    resetSentryForTests();
    if (dsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = dsn;
  });

  it("without a DSN nothing loads and every call is a no-op", async () => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    let imported = false;
    assert.equal(await loadSentry(async () => ((imported = true), fake([]))), null);
    assert.equal(imported, false);
    withSentry(() => assert.fail("must not run"));
    await tick();
    assert.equal(loadedSentry(), null);
  });

  it("queues calls until the SDK has loaded, then runs them and later ones at once", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://k@o0.ingest.example.invalid/1";
    const log: string[] = [];
    let release!: (m: NonNullable<Sdk>) => void;
    const loading = loadSentry(() => new Promise((r) => (release = r)));
    withSentry((S) => S.captureException("early"));
    assert.deepEqual(log, [], "nothing before the SDK has loaded");
    assert.equal(loadedSentry(), null);
    release(fake(log));
    await loading;
    await tick();
    assert.deepEqual(log, ["exc:early"]);
    withSentry((S) => S.captureException("late"));
    assert.deepEqual(log, ["exc:early", "exc:late"], "synchronous once loaded");
    assert.ok(loadedSentry());
  });

  it("a failed load drops the queued calls and never throws", async () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://k@o0.ingest.example.invalid/1";
    const loading = loadSentry(() => Promise.reject(new Error("chunk failed")));
    withSentry(() => assert.fail("must not run"));
    assert.equal(await loading, null);
    await tick();
    withSentry(() => {
      throw new Error("a broken hook");
    });
  });
});
