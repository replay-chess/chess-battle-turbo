// loggedCommand (server-logs.ts): the CI server logs keep every line and the server's exit code.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loggedCommand } from "./server-logs";

describe("loggedCommand", () => {
  it("is the command itself without E2E_LOG_DIR", () => {
    assert.equal(loggedCommand("web", "pnpm start", {}), "pnpm start");
  });

  it("writes stdout and stderr to <dir>/<name>.log and keeps the exit code (a failed build fails the start)", () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "srvlog-")), "logs");
    const cmd = loggedCommand("web", `echo "it's up" && echo boom >&2 && exit 3`, { E2E_LOG_DIR: dir });
    const run = spawnSync(cmd, { shell: true, encoding: "utf8" });
    assert.equal(run.status, 3);
    assert.match(run.stdout, /it's up/);
    assert.equal(readFileSync(path.join(dir, "web.log"), "utf8"), "it's up\nboom\n");
    execFileSync("bash", ["-c", loggedCommand("web", "echo again", { E2E_LOG_DIR: dir })]);
    assert.match(readFileSync(path.join(dir, "web.log"), "utf8"), /boom\nagain\n$/, "appends (a restarted server keeps the first boot's lines)");
  });

  it("refuses a name that is not a plain file name", () => {
    assert.throws(() => loggedCommand("../x", "true", { E2E_LOG_DIR: "/tmp" }));
  });
});
