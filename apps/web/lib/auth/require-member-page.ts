// The member gate for server pages (P2+; CDL §2.4). Layouts don't re-render on soft navigation, so every member
// page.tsx calls this itself; middleware's claim gate is only the fast path.
//
//   export default async function Page() {
//     const viewer = await requireMemberPage({ returnTo: "/train/bank" });
//     …
//   }
//
// Signed out → /sign-in?redirect_url=…; not onboarded → /onboarding; not a member → /pricing?reason=required|ended
// &redirect_url=… (plan §8.3, B26 default). The decision is guards.ts `pageGateRedirect` (unit-tested).
import "server-only";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { pageGateRedirect, type PageGateOptions } from "./guards";
import { getViewer, type Viewer } from "./viewer";

/** Header middleware may set with the requested path (1B·F4c request); used when the page passes no returnTo. */
export const PATHNAME_HEADER = "x-rc-pathname";

export async function requireMemberPage(options: PageGateOptions = {}): Promise<Viewer> {
  const viewer = await getViewer();
  const returnTo = options.returnTo ?? (await headers()).get(PATHNAME_HEADER);
  const target = pageGateRedirect(viewer, { ...options, returnTo });
  if (target) redirect(target);
  return viewer!;
}
