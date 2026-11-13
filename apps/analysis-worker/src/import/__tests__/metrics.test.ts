// Import metrics (phase-04 plan §10.2): the in-memory series served under `imports` by `/internal/metrics`, the same
// values sent to Sentry's metrics API, and the upstream stopwatch's closed endpoint set.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Metrics } from "../../obs/metrics";
import { RecordingTelemetry } from "../../obs/telemetry";
import { endpointOf, measuredFetch } from "../../providers/measure";
import { FakeClock } from "../../scheduler/clock";
import { IMPORT_METRICS, IMPORT_SERIES_MAX, ImportMetrics, ImportMetricsSnapshot, importMetric } from "../metrics";

const sink = () => ({
  metrics: new Metrics({ workerId: "w", bootId: "00000001", version: "0", profile: "sf18-v1" }, 0),
  telemetry: new RecordingTelemetry(),
});

describe("ImportMetrics", () => {
  it("keeps one series per name and attribute set: counts sum, distributions also give a p50", () => {
    const m = new ImportMetrics();
    m.record("import.games", 45, { provider: "chesscom", trigger: "initial" });
    m.record("import.games", 2, { provider: "chesscom", trigger: "daily" });
    m.record("import.games", 3, { trigger: "daily", provider: "chesscom" });
    for (const v of [10, 30, 20]) m.record("import.chunk_ms", v, { provider: "lichess", phase: "saving" });
    const snap = ImportMetricsSnapshot.parse(m.snapshot());
    const daily = snap.series.find((s) => s.name === "import.games" && s.attributes.trigger === "daily")!;
    assert.deepEqual([daily.count, daily.sum, daily.p50], [2, 5, null], "attribute order does not split a series");
    const chunk = snap.series.find((s) => s.name === "import.chunk_ms")!;
    assert.deepEqual([chunk.count, chunk.sum, chunk.p50], [3, 60, 20]);
    assert.equal(m.total("import.games"), 50);
    assert.equal(m.total("import.games", { trigger: "initial" }), 45);
    assert.equal(m.count("import.chunk_ms"), 3);
  });

  it("an attribute value outside the closed shape becomes `other` (never a username or a free string)", () => {
    const m = new ImportMetrics();
    m.record("import.skipped", 1, { reason: "Some Username With Spaces" });
    assert.equal(m.snapshot().series[0]!.attributes.reason, "other");
  });

  it("caps the number of series and counts what it dropped", () => {
    const m = new ImportMetrics();
    for (let i = 0; i < IMPORT_SERIES_MAX + 5; i++) m.record("import.skipped", 1, { reason: `r${i}` });
    const snap = ImportMetricsSnapshot.parse(m.snapshot());
    assert.equal(snap.series.length, IMPORT_SERIES_MAX);
    assert.equal(snap.dropped, 5);
  });

  it("importMetric records in memory and sends the same value to Sentry with the declared kind", () => {
    const s = sink();
    importMetric(s, "import.first_chunk_ms", 1200, { provider: "chesscom" });
    importMetric(s, "import.rate_limited", 1, { provider: "lichess" });
    assert.deepEqual(
      s.telemetry.metrics.map((x) => [x.kind, x.name, x.value]),
      [
        ["distribution", "import.first_chunk_ms", 1200],
        ["count", "import.rate_limited", 1],
      ],
    );
    assert.equal(s.metrics.imports.total("import.rate_limited", { provider: "lichess" }), 1);
    const body = s.metrics.snapshot(0, { draining: false, nextRunAtMs: null, lastDrainAtMs: null });
    assert.equal(body.imports.series.length, 2, "served by /internal/metrics");
  });

  it("every declared metric has a kind Sentry accepts", () => {
    for (const [name, def] of Object.entries(IMPORT_METRICS)) {
      assert.ok(["count", "distribution", "gauge"].includes(def.kind), name);
      assert.match(name, /^[a-z]+\.[a-z_]+$/);
    }
  });
});

describe("upstream stopwatch", () => {
  it("names endpoints from the path only", () => {
    assert.equal(endpointOf("chesscom", "/pub/player/knightowl_88"), "profile");
    assert.equal(endpointOf("chesscom", "/pub/player/knightowl_88/stats"), "stats");
    assert.equal(endpointOf("chesscom", "/pub/player/knightowl_88/games/archives"), "archives");
    assert.equal(endpointOf("chesscom", "/pub/player/knightowl_88/games/2026/10"), "month");
    assert.equal(endpointOf("lichess", "/api/games/user/knightowl88?max=5"), "export");
    assert.equal(endpointOf("lichess", "/api/account"), "other");
  });

  it("times provider calls by status class and leaves other URLs alone", async () => {
    const clock = new FakeClock(0);
    const s = sink();
    const bases = { chesscom: "http://up.test/chesscom", lichess: "http://up.test/lichess" };
    const inner = async (url: string) => {
      await clock.advance(40);
      if (url.endsWith("/boom")) throw new Error("network");
      return new Response(null, { status: url.includes("2026/10") ? 304 : 200 });
    };
    const f = measuredFetch(inner, bases, clock, s);
    await f(`${bases.chesscom}/pub/player/a/games/2026/10`, {});
    await f(`${bases.chesscom}/pub/player/a`, {});
    await assert.rejects(f(`${bases.lichess}/boom`, {}));
    await f("http://websocket:3002/internal/emit", {});
    const series = s.metrics.imports.snapshot().series.map((x) => [x.attributes.endpoint, x.attributes.status, x.sum]);
    assert.deepEqual(series, [
      ["month", "304", 40],
      ["profile", "2xx", 40],
      ["other", "error", 40],
    ]);
  });
});
