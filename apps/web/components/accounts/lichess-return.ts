// The Lichess OAuth round trip seen from /settings/connected (phase-04 plan §7.3.4, §7.3.5): the OAU-1 start URL and
// the one-time `?lichess=linked|denied|error[&reason=]` return. Pure, so the unit tests read it without React.
import { endpoints } from "@/lib/api/endpoints";
import type { LichessReturn } from "./LichessConnect";

export const SETTINGS_RETURN_PATH = "/settings/connected";

export type LichessParam = { lichess: string | null; reason: string | null };

/** The OAuth return of `?lichess=…&reason=…` (unknown values: none). */
export function lichessReturnOf(param: LichessParam): { returned: LichessReturn; linked: boolean } {
  if (param.lichess === "linked") return { returned: null, linked: true };
  if (param.lichess === "denied") return { returned: { kind: "denied" }, linked: false };
  if (param.lichess === "error") return { returned: { kind: "error", reason: param.reason }, linked: false };
  return { returned: null, linked: false };
}

/** The OAU-1 URL for a return to this page. */
export function lichessStartHref(): string {
  return `${endpoints.lichessStart}?returnTo=${encodeURIComponent(SETTINGS_RETURN_PATH)}`;
}

/** The URL without the consumed OAuth parameters (other parameters stay). */
export function withoutLichessParams(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("lichess");
  url.searchParams.delete("reason");
  const qs = url.searchParams.toString();
  return `${url.pathname}${qs ? `?${qs}` : ""}${url.hash}`;
}
