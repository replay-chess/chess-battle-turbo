// The provider canary's drift issue (phase-04 plan §12.5b: "Two failures in a row open a GitHub issue (label
// `provider-drift`, assignee the owner)"). Called from nightly.yml's github-script step:
//   await require("./packages/chess-import/scripts/lib/drift-issue.cjs").fileDriftIssue({ github, context, core, previous, assignee })
//
// FIX-2 (review round 2): the step assigned `context.repo.owner`, which is the organisation `replay-chess`, not a user;
// GitHub drops an assignee that is not a user with push access, so the issue opened unassigned and nobody was
// notified. The assignee is now a user login: the repository variable CANARY_ISSUE_ASSIGNEE (owner action), else the
// actor of the scheduled run (the last user to change the schedule). It is checked with "check if a user can be
// assigned" first; a login that cannot be assigned is reported as a warning and the issue still opens, with a note.
/* global module */
"use strict";

const TITLE = "provider-drift: the provider canary failed two nights in a row";
const LABEL = "provider-drift";

/** The login to assign, or null (an organisation, a bot or nothing). */
function assigneeLogin({ assignee, context }) {
  const candidates = [assignee, context.actor];
  for (const raw of candidates) {
    const login = typeof raw === "string" ? raw.trim().replace(/^@/, "") : "";
    if (!login || login.endsWith("[bot]")) continue;
    if (login.toLowerCase() === String(context.repo.owner).toLowerCase()) continue;
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) continue;
    return login;
  }
  return null;
}

async function canAssign(github, context, login) {
  try {
    await github.rest.issues.checkUserCanBeAssigned({ ...context.repo, assignee: login });
    return true;
  } catch (err) {
    if (err && err.status === 404) return false;
    throw err;
  }
}

/**
 * Opens the drift issue on the second failure in a row, unless one is already open. Returns what it did, for the
 * job log and the unit test: "first_failure" | "already_open" | "opened".
 */
async function fileDriftIssue({ github, context, core, previous, assignee }) {
  if (!previous || previous.failed !== true) {
    core.warning("provider canary failed once; an issue opens if it fails again tomorrow");
    return { action: "first_failure" };
  }
  const { data: open } = await github.rest.search.issuesAndPullRequests({
    q: `repo:${context.repo.owner}/${context.repo.repo} is:issue is:open label:${LABEL} in:title "provider canary"`,
  });
  if (open.total_count) return { action: "already_open" };

  const login = assigneeLogin({ assignee, context });
  const assignable = login ? await canAssign(github, context, login) : false;
  if (!assignable) {
    core.warning(
      login
        ? `provider-drift: ${login} cannot be assigned in ${context.repo.owner}/${context.repo.repo}; set the repository variable CANARY_ISSUE_ASSIGNEE to a user with push access`
        : "provider-drift: no user to assign; set the repository variable CANARY_ISSUE_ASSIGNEE to the owner's GitHub login",
    );
  }
  const run = `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`;
  const body = [
    `The nightly provider canary (packages/chess-import/scripts/canary.ts) failed on two consecutive nights. The report is the \`provider-canary\` artifact of ${run}.`,
    "A new or a missing field in Chess.com's or Lichess's answers fails the strict schemas: update packages/chess-import and its fixtures.",
    ...(assignable ? [] : ["", "Nobody could be assigned: set the repository variable `CANARY_ISSUE_ASSIGNEE` to the owner's GitHub login."]),
  ].join("\n");
  const { data: issue } = await github.rest.issues.create({
    ...context.repo,
    title: TITLE,
    labels: [LABEL],
    ...(assignable ? { assignees: [login] } : {}),
    body,
  });
  const assigned = (issue.assignees || []).map((a) => a.login);
  if (assignable && !assigned.includes(login)) core.warning(`provider-drift: GitHub dropped the assignee ${login}`);
  return { action: "opened", assignees: assigned, number: issue.number };
}

module.exports = { fileDriftIssue, assigneeLogin, TITLE, LABEL };
