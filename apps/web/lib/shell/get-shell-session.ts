// Server-only read of the viewer for the (app) layout (SPEC 9.3).
// The Prisma read lives in `readShellRecord` and nowhere else, so 1B·J can swap
// it for `getViewerRecord()` without touching the pure `toShellSession` mapping.
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isPaywallEnabled } from "@/lib/auth/require-subscription";
import { ENTITLEMENT_SELECT } from "@/lib/billing/entitlement";
import { getProductCatalog } from "@/lib/billing/products";
import { toShellSession, type ShellSession, type ShellUserRecord } from "./shell-user";

const SHELL_USER_SELECT = {
  referenceId: true,
  name: true,
  profilePictureUrl: true,
  role: true,
  dodoCustomerId: true,
  ...ENTITLEMENT_SELECT,
  chessComProfile: { select: { blitzRating: true, rapidRating: true } },
} as const;

/** The one DB statement per render. Same lookup as `lib/auth/resolve-user.ts`: googleId = Clerk user id. */
async function readShellRecord(clerkUserId: string): Promise<ShellUserRecord | null> {
  return prisma.user.findUnique({ where: { googleId: clerkUserId }, select: SHELL_USER_SELECT });
}

/**
 * The signed-in viewer's shell data, or null when signed out or when the user
 * row doesn't exist yet (first sign-in, before UserSync). Null means marketing
 * chrome. Memoised per request with React `cache()`.
 */
export const getShellSession = cache(async (): Promise<ShellSession | null> => {
  const { userId } = await auth();
  if (!userId) return null;
  const record = await readShellRecord(userId);
  if (!record) return null;
  return toShellSession(record, {
    now: new Date(),
    paywallEnabled: isPaywallEnabled(),
    catalog: getProductCatalog(),
  });
});
