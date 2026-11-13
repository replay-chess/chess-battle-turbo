// Runs the after-commit effects of the account routes (lib/accounts/link-service.ts `LinkEffect`) inside `after()`:
// worker kicks, audit rows, the legacy chess_com_profiles dual-write, cache-tag revalidation and server events. Each
// effect is isolated: one failing (a P2002 on the legacy `chessComHandle @unique`, an unreachable worker) is logged
// and the rest still run; nothing here can fail the response that scheduled it.
import type { Viewer } from "@/lib/auth/viewer";
import { audit } from "@/lib/audit";
import { getRouteDeps } from "@/lib/api/context";
import { rawDb } from "@/lib/games/snapshot.server";
import { kickImports } from "@/lib/jobs/import";
import { legacyProfileColumns, type LinkEffect } from "./link-service";
import { captureAccountsServerEvent } from "./telemetry";

export type EffectContext = { viewer: Pick<Viewer, "id" | "ref">; requestId: string; now: Date };

type Revalidate = (tag: string) => void | Promise<void>;

const defaultRevalidate: Revalidate = async (tag) => {
  const { revalidateTag } = await import("next/cache");
  revalidateTag(tag);
};

let revalidate: Revalidate = defaultRevalidate;

/** Test seam: Next's revalidateTag needs a request scope; tests record the tags instead. Returns a restore function. */
export function setRevalidateTag(next: Revalidate): () => void {
  const previous = revalidate;
  revalidate = next;
  return () => {
    revalidate = previous;
  };
}

async function runOne(effect: LinkEffect, ctx: EffectContext): Promise<void> {
  switch (effect.kind) {
    case "kick":
      await kickImports(effect.reason);
      return;
    case "audit": {
      const { prisma } = await import("@/lib/prisma");
      await audit(rawDb(prisma), {
        category: "ACCOUNT",
        action: effect.action,
        actorKind: "USER",
        actorUserId: ctx.viewer.id,
        targetType: "linked_account",
        targetId: effect.provider,
        requestId: ctx.requestId.slice(0, 40),
        meta: effect.meta,
      });
      return;
    }
    case "dual_write": {
      const { prisma } = await import("@/lib/prisma");
      const columns = legacyProfileColumns(effect.profile, effect.stats, ctx.now);
      try {
        await prisma.chessComProfile.upsert({
          where: { userId: ctx.viewer.id },
          create: { userId: ctx.viewer.id, ...columns },
          update: columns,
        });
      } catch (err) {
        // §8.15: two members may claim the same unverified handle; the legacy readers only need the first claimant.
        if ((err as { code?: unknown }).code === "P2002") {
          getRouteDeps().log("info", "accounts.dual_write_skipped", { reason: "handle_taken" });
          return;
        }
        throw err;
      }
      return;
    }
    case "revalidate":
      await revalidate(effect.tag);
      return;
    case "event":
      await captureAccountsServerEvent(effect.name, effect.props, ctx.viewer.ref);
      return;
  }
}

/** Runs every effect, in order, each in its own try/catch. */
export async function runLinkEffects(effects: readonly LinkEffect[], ctx: EffectContext): Promise<void> {
  for (const effect of effects) {
    try {
      await runOne(effect, ctx);
    } catch (err) {
      getRouteDeps().telemetry.captureException(err, { tags: { area: "accounts", effect: effect.kind } });
    }
  }
}
