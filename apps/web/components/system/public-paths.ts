// The session modal's "public page" test (plan §4.9), from the middleware's route classes (lib/auth/route-classes,
// 1B·F4c) so the two never disagree. One deliberate difference: /dev/** is public to middleware (the gallery
// needs no sign-in) but watched here, so /dev/ui/data can demonstrate the session-expired modal (T15).
// SessionWatcher installs it with setPublicPathClassifier (1B·J).
import { classify } from "@/lib/auth/route-classes";

const DEV = /^\/dev(\/|$)/;

export function isPublicByRouteClass(pathname: string): boolean {
  const cls = classify(pathname);
  return (cls === "public" || cls === "public_static") && !DEV.test(pathname);
}
