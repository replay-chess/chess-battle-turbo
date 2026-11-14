// The runner's resume URL (§4.4 "a reload resumes"): an entry URL (/train/puzzles, ?plan, ?card, ?theme …) becomes
// `?s=<ref>` without a second render. The state argument must be null: Next.js patches history.replaceState and treats
// a state object carrying its own markers (`__NA`, which window.history.state always has) as its own call, so it does
// not move the router to the new URL. The router then still believed the page was the bare entry URL, and the next
// refresh of the route (a theme switch's navigation, a dev Fast Refresh) rendered that URL again: create-or-resume made
// a new session and abandoned the one the member was on (regression, P5 INTEGRATE-2 smoke T7: a Pins session abandoned
// 315 ms after it started, the member sent to /train). With null, Next copies its internals and syncs the router.
export type HistoryLike = Pick<History, "replaceState">;

export function setResumeUrl(url: string, history: HistoryLike = window.history): void {
  history.replaceState(null, "", url);
}
