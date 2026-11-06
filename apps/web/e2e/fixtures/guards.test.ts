import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLERK_CHUNK_ABORT, CLERK_PROTECT_PROBE, classifyConsole, classifyResponse } from "./console-guard";
import { auditEvents, matchesProps } from "./telemetry";

describe("console guard rules", () => {
  it("fails on console.error and hydration messages, unless allow-listed", () => {
    assert.equal(classifyConsole("error", "boom", [])?.kind, "console");
    assert.equal(classifyConsole("warning", "Warning: Text content does not match server-rendered HTML", [])?.kind, "hydration");
    assert.equal(classifyConsole("error", "ResizeObserver loop limit exceeded", [/ResizeObserver loop/]), null);
    assert.equal(classifyConsole("log", "hello", []), null);
  });

  it("leaves network failures to the response rule", () => {
    assert.equal(classifyConsole("error", "Failed to load resource: the server responded with a status of 401 ()", []), null);
    assert.equal(classifyConsole("error", "Failed to load resource: net::ERR_NAME_NOT_RESOLVED", []), null);
  });

  it("regression: webkit-console-noise: WebKit's third-party, aborted-prefetch and media-control lines are not problems", () => {
    const corp =
      "Cancelled load to https://dailypings.com/badge.svg because it violates the resource's Cross-Origin-Resource-Policy response header.";
    assert.equal(classifyConsole("error", corp, []), null);
    assert.equal(classifyConsole("error", "Cannot load image https://dailypings.com/badge.svg due to access control checks.", []), null);
    assert.equal(
      classifyConsole(
        "error",
        "Failed to fetch RSC payload for http://localhost:3000/profile/abc. Falling back to browser navigation. TypeError: Load failed",
        [],
      ),
      null,
    );
    assert.equal(
      classifyConsole("error", "Button failed to load, iconName = pip-placard, layoutTraits = [MacOSLayoutTraits Inline], src = blob:x", []),
      null,
    );
  });

  it("regression: clerk-chunk-abort: a Clerk CDN chunk aborted by navigation is not a problem; our own chunks still are", () => {
    const clerk =
      "ChunkLoadError: Loading chunk 2270 failed.\n(error: https://loving-martin-7959.clerk.accounts.dev/npm/@clerk/clerk-js@5.128.0/dist/userbutton_clerk.browser_70f75e_5.128.0.js)";
    assert.equal(classifyConsole("error", clerk, []), null);
    // The uncaught page error carries the same text without the "ChunkLoadError: " prefix.
    assert.ok(CLERK_CHUNK_ABORT.test(clerk.replace("ChunkLoadError: ", "")));
    // The production instance serves its chunks from clerk.<domain>.
    assert.ok(CLERK_CHUNK_ABORT.test("Loading chunk 12 failed.\n(error: https://clerk.playchess.tech/npm/@clerk/clerk-js@5/dist/x.js)"));
    const own = "ChunkLoadError: Loading chunk 812 failed.\n(error: http://localhost:3000/_next/static/chunks/812.js)";
    assert.equal(classifyConsole("error", own, [])?.kind, "console");
    assert.equal(CLERK_CHUNK_ABORT.test("Loading chunk 9 failed.\n(error: https://evil.example/npm/@clerk/x.js)"), false);
  });

  it("still fails on a blocked same-origin load and on other RSC fetch errors", () => {
    const own =
      "Cancelled load to http://localhost:3000/x.svg because it violates the resource's Cross-Origin-Resource-Policy response header.";
    assert.equal(classifyConsole("error", own, [])?.kind, "console");
    assert.equal(classifyConsole("error", "Cannot load image http://127.0.0.1:3000/a.png due to access control checks.", [])?.kind, "console");
    assert.equal(
      classifyConsole("error", "Failed to fetch RSC payload for http://localhost:3000/play. Falling back to browser navigation. Error: boom", [])
        ?.kind,
      "console",
    );
  });

  it("fails on /api and page 5xx the spec did not inject", () => {
    assert.equal(classifyResponse("http://x/api/me", 500, {})?.kind, "api5xx");
    assert.equal(classifyResponse("http://x/api/me", 503, { "x-rc-fault": "503" }), null);
    assert.equal(classifyResponse("http://x/api/me", 429, {}), null);
    assert.equal(classifyResponse("http://x/_next/static/a.js", 500, {}, "script"), null);
    assert.equal(classifyResponse("http://x/play", 500, {}, "document")?.kind, "api5xx");
  });
});

describe("console guard: Clerk bot-protection probes (regression: REGRESSION-2)", () => {
  const host = "1-lvchtghgfm2qtpgbrzo7a5uili-qqqlrdrxbaqzo5qy4qn4h773b4-p.client.protect.clerk.com";
  it("excuses WebKit's blocked probes on every port and the /c/<id>/probe form", () => {
    for (const t of [
      `/${host}:8443/ins_3LN0o48EllqOBg7LenZniwnJEFd/probe due to access control checks.`,
      `/${host}/ins_3LN0o48EllqOBg7LenZniwnJEFd/probe due to access control checks.`,
      `/${host}/ins_3LN0o48EllqOBg7LenZniwnJEFd/c/1-abc/probe due to access control checks.`,
    ]) {
      assert.ok(CLERK_PROTECT_PROBE.test(t), t);
      assert.equal(classifyConsole("error", t, []), null);
    }
  });
  it("still reports our own access-control errors and look-alike hosts", () => {
    assert.equal(CLERK_PROTECT_PROBE.test("/localhost:3000/api/me due to access control checks."), false);
    assert.equal(CLERK_PROTECT_PROBE.test("/x.client.protect.clerk.com.evil.example/ins_1/probe due to access control checks."), false);
    assert.equal(CLERK_PROTECT_PROBE.test(`/${host}/ins_1/other due to access control checks.`), false);
  });
});

describe("telemetry audit", () => {
  it("matches props shallowly", () => {
    assert.ok(matchesProps({ dest: "legends", surface: "rail" }, { dest: "legends" }));
    assert.ok(!matchesProps({ dest: "play" }, { dest: "legends" }));
    assert.ok(matchesProps({ a: 1 }, undefined));
  });

  it("reports unknown events, extra keys and PII", () => {
    const problems = auditEvents(
      [
        { source: "client", event: "shell_palette_opened", props: { via: "button" }, ts: 0 },
        { source: "client", event: "made_up", props: {}, ts: 0 },
        { source: "client", event: "shell_palette_opened", props: { via: "button", q: "x" }, ts: 0 },
        { source: "server", event: "billing_refreshed", props: { result: "changed", source: "activation", $lib: "posthog-node", app_env: "test" }, ts: 0 },
        { source: "client", event: "shell_palette_command", props: { id: "goto:play", group: "goto", queryLength: 4 }, ts: 0 },
      ],
      ["goto:play"],
    );
    assert.equal(problems.length, 3, problems.join("\n"));
    assert.ok(problems.some((p) => p.includes("unregistered event")));
    assert.ok(problems.some((p) => p.includes('Unrecognized key: "q"')));
    assert.ok(problems.some((p) => p.includes("PII (forbidden)")));
  });
});
