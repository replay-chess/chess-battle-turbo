// /onboarding/confirm?provider=chesscom&u=… | ?provider=lichess (phase-04 plan §4.3, §5.4). Server.
//
// The guard runs first (a valid `u`, or a Lichess link). The preview (Chess.com profile + stats from the lookup's
// 600 s cache, the newest games; Lichess: the linked row + its newest games) streams inside <Suspense>: the fallback
// is the board's `loading` state. A profile that no longer exists → Link `?error=not_found&u=…`; one another member
// holds (verified) → Link `?error=linked_elsewhere`; the provider not answering → the inline "didn't answer" card. A
// Chess.com preview spends the lookup's rate-limit buckets first (lib/onboarding/confirm-limit.ts); over the limit is
// the same inline card.
import { headers } from "next/headers";
import { Suspense } from "react";
import { ClientRedirect } from "@/components/onboarding/ClientRedirect";
import { ConfirmStep, type RecentRow } from "@/components/onboarding/ConfirmStep";
import { isApiError } from "@/lib/api/api-error";
import type { Viewer } from "@/lib/auth/viewer";
import { getAccountPreview } from "@/lib/data/accounts";
import { loadStepPage } from "@/lib/data/onboarding";
import { relativeDay } from "@/lib/onboarding/confirm-view";
import { limitConfirmLookup } from "@/lib/onboarding/confirm-limit";
import { normaliseTyped } from "@/lib/onboarding/link-state";
import { clientIpFrom } from "@/lib/rate-limit-db";
import { stepPath } from "@/lib/onboarding/steps";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function ConfirmLoaded({
  viewer,
  provider,
  username,
  now,
  timeZone,
}: {
  viewer: Viewer;
  provider: "chesscom" | "lichess";
  username: string | null;
  now: number;
  timeZone: string;
}) {
  let preview: Awaited<ReturnType<typeof getAccountPreview>>;
  try {
    // A Chess.com handle from the URL spends the lookup's per-user and per-IP buckets (plan §11.2, FIX-1).
    if (provider === "chesscom" && username) {
      await limitConfirmLookup({ clerkUserId: viewer.clerkUserId || null, ip: clientIpFrom(await headers()) });
    }
    preview = await getAccountPreview(viewer, provider, username, { now: new Date(now) });
  } catch (err) {
    if (isApiError(err) && err.code === "not_found") {
      const to = provider === "chesscom" && username ? `${stepPath("link")}?error=not_found&u=${encodeURIComponent(username)}` : stepPath("link");
      return <ClientRedirect to={to} />;
    }
    if (isApiError(err) && err.code === "conflict") return <ClientRedirect to={`${stepPath("link")}?error=linked_elsewhere`} />;
    if (isApiError(err) && (err.code === "upstream_unavailable" || err.code === "rate_limited")) {
      return <ConfirmStep provider={provider} username={username} view={{ state: "unavailable" }} />;
    }
    throw err;
  }
  const nowDate = new Date(now);
  const recent: RecentRow[] | null =
    preview.recent === null
      ? null
      : preview.recent.map((g) => ({
          result: g.result,
          opponentName: g.opponentName,
          opponentRating: g.opponentRating,
          openingName: g.openingName,
          dayLabel: relativeDay(g.endedAt, nowDate, timeZone),
        }));
  return <ConfirmStep provider={provider} username={username} view={{ state: "ready", account: preview.account, recent }} />;
}

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const { viewer, state, now } = await loadStepPage("confirm", sp);
  const provider = one(sp.provider) === "lichess" ? "lichess" : "chesscom";
  const raw = one(sp.u);
  const username = provider === "chesscom" && raw ? normaliseTyped(raw) : null;
  return (
    <Suspense key={`${provider}:${username ?? ""}`} fallback={<ConfirmStep provider={provider} username={username} view={{ state: "loading" }} />}>
      <ConfirmLoaded viewer={viewer} provider={provider} username={username} now={now} timeZone={state.timeZone} />
    </Suspense>
  );
}
