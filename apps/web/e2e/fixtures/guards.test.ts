import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyConsole, classifyResponse } from "./console-guard";
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

  it("fails on /api and page 5xx the spec did not inject", () => {
    assert.equal(classifyResponse("http://x/api/me", 500, {})?.kind, "api5xx");
    assert.equal(classifyResponse("http://x/api/me", 503, { "x-rc-fault": "503" }), null);
    assert.equal(classifyResponse("http://x/api/me", 429, {}), null);
    assert.equal(classifyResponse("http://x/_next/static/a.js", 500, {}, "script"), null);
    assert.equal(classifyResponse("http://x/play", 500, {}, "document")?.kind, "api5xx");
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
