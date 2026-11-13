// The canary's drift issue (phase-04 plan §12.5b). regression: canary-issue-assigns-org (FIX-2, review round 2): the
// step assigned `context.repo.owner`, i.e. the organisation, which GitHub drops, so the owner was never notified.
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { fileDriftIssue, assigneeLogin } = require("./lib/drift-issue.cjs") as {
  fileDriftIssue: (input: Record<string, unknown>) => Promise<{ action: string; assignees?: string[] }>;
  assigneeLogin: (input: { assignee?: string; context: Record<string, unknown> }) => string | null;
};

const context = { repo: { owner: "replay-chess", repo: "chess-battle-turbo" }, actor: "replay-chess", serverUrl: "https://github.com", runId: 7 };

function fakeGithub(opts: { open?: number; assignable?: string[] }) {
  const created: Record<string, unknown>[] = [];
  const checked: string[] = [];
  const github = {
    rest: {
      search: { issuesAndPullRequests: async () => ({ data: { total_count: opts.open ?? 0 } }) },
      issues: {
        checkUserCanBeAssigned: async ({ assignee }: { assignee: string }) => {
          checked.push(assignee);
          if (!(opts.assignable ?? []).includes(assignee)) throw Object.assign(new Error("Not Found"), { status: 404 });
          return { status: 204 };
        },
        create: async (req: Record<string, unknown>) => {
          created.push(req);
          const assignees = ((req.assignees as string[] | undefined) ?? []).filter((l) => (opts.assignable ?? []).includes(l));
          return { data: { number: 12, assignees: assignees.map((login) => ({ login })) } };
        },
      },
    },
  };
  const warnings: string[] = [];
  return { github, created, checked, warnings, core: { warning: (m: string) => warnings.push(m) } };
}

describe("provider canary drift issue", () => {
  it("the organisation is never the assignee; the repository variable names the owner", () => {
    assert.equal(assigneeLogin({ context }), null, "the scheduled actor here is the org: nobody");
    assert.equal(assigneeLogin({ assignee: "@owner-login", context }), "owner-login");
    assert.equal(assigneeLogin({ assignee: "", context: { ...context, actor: "owner-login" } }), "owner-login");
    assert.equal(assigneeLogin({ assignee: "github-actions[bot]", context }), null);
    assert.equal(assigneeLogin({ assignee: "Replay-Chess", context }), null);
  });

  it("first failure: a warning, no issue", async () => {
    const f = fakeGithub({ assignable: ["owner-login"] });
    const out = await fileDriftIssue({ ...f, context, previous: { failed: false }, assignee: "owner-login" });
    assert.equal(out.action, "first_failure");
    assert.equal(f.created.length, 0);
  });

  it("second failure in a row: the issue is assigned to the owner's login, checked first", async () => {
    const f = fakeGithub({ assignable: ["owner-login"] });
    const out = await fileDriftIssue({ ...f, context, previous: { failed: true }, assignee: "owner-login" });
    assert.equal(out.action, "opened");
    assert.deepEqual(f.checked, ["owner-login"]);
    assert.deepEqual(f.created[0]!.assignees, ["owner-login"]);
    assert.deepEqual(f.created[0]!.labels, ["provider-drift"]);
    assert.notEqual((f.created[0]!.assignees as string[])[0], context.repo.owner);
    assert.deepEqual(out.assignees, ["owner-login"]);
    assert.deepEqual(f.warnings, []);
  });

  it("an assignee GitHub would drop is reported, and the issue still opens with a note", async () => {
    const f = fakeGithub({ assignable: [] });
    const out = await fileDriftIssue({ ...f, context, previous: { failed: true }, assignee: "someone-else" });
    assert.equal(out.action, "opened");
    assert.equal("assignees" in f.created[0]!, false);
    assert.match(String(f.created[0]!.body), /CANARY_ISSUE_ASSIGNEE/);
    assert.match(f.warnings[0]!, /cannot be assigned/);
  });

  it("an open drift issue is not duplicated", async () => {
    const f = fakeGithub({ open: 1, assignable: ["owner-login"] });
    assert.equal((await fileDriftIssue({ ...f, context, previous: { failed: true }, assignee: "owner-login" })).action, "already_open");
    assert.equal(f.created.length, 0);
  });
});
