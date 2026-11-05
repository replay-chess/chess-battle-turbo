// In-app navigation counter (SPEC 8.2): +1 on a push, -1 (not below 0) on a
// traverse, reset by a full page load (the module re-evaluates). TopBar's Back
// uses router.back() only when there is in-app history to go back to.
// instrumentation-client.ts imports this module so it counts from the first load.

export type NavigationType = "push" | "replace" | "traverse";

let count = 0;

export function recordNavigation(type: NavigationType): void {
  if (type === "push") count += 1;
  else if (type === "traverse") count = Math.max(0, count - 1);
}

export function inAppNavCount(): number {
  return count;
}

let installed = false;

/** Listens for `rc:navigation-start` once per page load. */
export function installNavHistory(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("rc:navigation-start", (e) => {
    const detail = (e as CustomEvent<{ navigationType?: NavigationType }>).detail;
    if (detail?.navigationType) recordNavigation(detail.navigationType);
  });
}

installNavHistory();
