// The viewer's `trial.eligible` with the trial ledger asked (phase-04 plan 6.3, 7.2 "`/api/me` trial.eligible (cached
// per request)", 8.4.3; FIX-1). `entitlementOf` (lib/auth/membership.ts) reads only the users row: a re-signup, or a
// Gmail dot / +tag variant of an email that already had a trial, looked eligible, so Welcome, Plan and /pricing
// offered "Start free trial" and a charge date, and the checkout (decideTrial, which does ask the ledger) then sent
// `trial: false` and Dodo charged at once.
//
// One statement (LEDGER_PROBE_SQL on the email hash and the viewer's VERIFIED handles, carried on the viewer row), and
// only when the row says eligible: members, trialists and lapsed members pay nothing. A probe that fails keeps the
// row's answer (the checkout asks again and never offers a trial the ledger refuses).
import type { Viewer } from "@/lib/auth/viewer";
import { checkTrialLedger, type LedgerDb, type LedgerHit } from "./trial-ledger";

export type LedgerProbe = (input: { email: string; handles: NonNullable<Viewer["ledgerHandles"]> }) => Promise<LedgerHit>;

/** The default probe: the app's Prisma client and HASH_PEPPER from the environment. */
export const defaultLedgerProbe: LedgerProbe = async (input) => {
  const { prisma } = await import("@/lib/prisma");
  return checkTrialLedger(prisma as unknown as LedgerDb, input);
};

/** True when the viewer's row says eligible and the ledger has no row for their email or verified handles. */
export async function ledgerTrialEligible(
  viewer: Pick<Viewer, "entitlement" | "billing" | "ledgerHandles">,
  probe: LedgerProbe = defaultLedgerProbe,
  onError: (err: unknown) => void = () => undefined,
): Promise<boolean> {
  if (!viewer.entitlement.trial.eligible) return false;
  try {
    const hit = await probe({ email: viewer.billing.email, handles: viewer.ledgerHandles ?? [] });
    return !hit.hit;
  } catch (err) {
    onError(err);
    return true;
  }
}

/** The viewer with `entitlement.trial.eligible` answered by the ledger too (a new object; the input is unchanged). */
export async function withLedgerEligibility<V extends Pick<Viewer, "entitlement" | "billing" | "ledgerHandles">>(
  viewer: V,
  probe: LedgerProbe = defaultLedgerProbe,
  onError?: (err: unknown) => void,
): Promise<V> {
  if (!viewer.entitlement.trial.eligible) return viewer;
  if (await ledgerTrialEligible(viewer, probe, onError)) return viewer;
  return { ...viewer, entitlement: { ...viewer.entitlement, trial: { ...viewer.entitlement.trial, eligible: false } } };
}
