// /game/[ref] (P2 plan 5.1): a server component. One query after the viewer (getGameSnapshot, React cache()),
// no client fetch on mount: the board paints from the snapshot in `loading`, then the socket's join ack replaces it.
// Members only, except a player of an IN_PROGRESS game whose membership lapsed mid-game (plan 4.7, 11). Spectators
// see watchable games only; a game the viewer may not see is a 404, so its existence is not leaked.
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/viewer";
import { pageGateRedirect } from "@/lib/auth/guards";
import { getFlags } from "@/lib/flags";
import { getGameSnapshot } from "@/lib/games/snapshot.server";
import { GameScreen } from "@/features/game/screen/GameScreen";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Game", robots: { index: false, follow: false } };

export default async function GamePage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const returnTo = `/game/${ref}`;
  const viewer = await getViewer();
  if (!viewer) redirect(`/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);

  const snapshot = await getGameSnapshot(ref, viewer);
  if (!snapshot) notFound();

  const lapsedLivePlayer = snapshot.you.role === "player" && snapshot.status === "IN_PROGRESS";
  const target = pageGateRedirect(viewer, { returnTo });
  if (target && !(lapsedLivePlayer && viewer.user.onboarded)) redirect(target);
  if (snapshot.you.role === "spectator" && !snapshot.watchable) notFound();

  const flags = await getFlags(viewer);
  return (
    <GameScreen
      snapshot={snapshot}
      flags={{ gameV3: flags["game-v3"], liveProtocolV2: flags["live-protocol-v2"] }}
      viewerRef={viewer.ref}
    />
  );
}
