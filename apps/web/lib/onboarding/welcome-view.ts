// Welcome's row 04 (phase-04 plan §4.1). Pure and client-safe.
//
//   default     trial eligible: "Start your free trial" · "7 DAYS FREE"
//   trial used  "Start your membership", no tag
//   a member    already entitled when setup starts (a trial or a subscription bought from /pricing first, D9): the row
//               says what they have, in the activation screens' words (§4.9 "Your free trial has started." / "Your
//               membership is active."), never "Start …": the resolver skips Plan for them.

/** What the viewer already has when Welcome renders (null: not a member). */
export type WelcomeMembership = { kind: "trial"; daysLeft: number | null } | { kind: "member" } | null;

export function welcomeMembership(e: { member: boolean; trial: { active: boolean; daysLeft: number | null } }): WelcomeMembership {
  if (!e.member) return null;
  return e.trial.active ? { kind: "trial", daysLeft: e.trial.daysLeft } : { kind: "member" };
}

export function welcomeMembershipRow(trialEligible: boolean, membership: WelcomeMembership): { text: string; tag: string | null } {
  if (membership?.kind === "trial") {
    const d = membership.daysLeft;
    return { text: "Your free trial has started", tag: d === null ? "TRIAL" : `${d} ${d === 1 ? "DAY" : "DAYS"} LEFT` };
  }
  if (membership?.kind === "member") return { text: "Your membership is active", tag: null };
  return trialEligible ? { text: "Start your free trial", tag: "7 DAYS FREE" } : { text: "Start your membership", tag: null };
}
