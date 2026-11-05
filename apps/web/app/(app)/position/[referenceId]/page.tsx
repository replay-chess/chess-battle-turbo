import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { PositionPageClient } from "./PositionPageClient";

interface Props {
  params: Promise<{ referenceId: string }>;
  searchParams: Promise<{ type?: string }>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { referenceId } = await params;
  const { type } = await searchParams;

  if (type === "opening") {
    const opening = await prisma.opening.findUnique({
      where: { referenceId },
      select: { name: true, eco: true },
    });

    if (!opening) {
      return { title: "Position Not Found", robots: { index: false, follow: false } };
    }

    const title = `${opening.name}${opening.eco ? ` (${opening.eco})` : ""} — Play This Opening`;
    const description = `Play the ${opening.name} opening on ReplayChess. Challenge a friend or play against the bot.`;
    const ogImageUrl = `/og?title=${encodeURIComponent(opening.name)}&subtitle=${encodeURIComponent(opening.eco || "Opening")}&type=opening`;

    return {
      title,
      description,
      alternates: { canonical: `https://www.playchess.tech/position/${referenceId}?type=opening` },
      openGraph: {
        title,
        description,
        url: `https://www.playchess.tech/position/${referenceId}?type=opening`,
        siteName: "ReplayChess",
        images: [{ url: ogImageUrl, width: 1200, height: 630, alt: opening.name }],
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [ogImageUrl],
      },
    };
  }

  const position = await prisma.chessPosition.findUnique({
    where: { referenceId },
    select: { whitePlayerName: true, blackPlayerName: true, tournamentName: true },
  });

  if (!position) {
    return { title: "Position Not Found", robots: { index: false, follow: false } };
  }

  const hasPlayers = position.whitePlayerName && position.blackPlayerName;
  const title = hasPlayers
    ? `${position.whitePlayerName} vs ${position.blackPlayerName} — Play This Position`
    : "Play This Position";
  const description = hasPlayers
    ? `Play the position from ${position.whitePlayerName} vs ${position.blackPlayerName}${position.tournamentName ? ` (${position.tournamentName})` : ""} on ReplayChess.`
    : "Play this chess position on ReplayChess. Challenge a friend or play against the bot.";
  const ogImageUrl = hasPlayers
    ? `/og?title=${encodeURIComponent(`${position.whitePlayerName} vs ${position.blackPlayerName}`)}&subtitle=${encodeURIComponent(position.tournamentName || "Chess Position")}&type=legend`
    : `/og?title=${encodeURIComponent("Shared Position")}&type=legend`;

  return {
    title,
    description,
    alternates: { canonical: `https://www.playchess.tech/position/${referenceId}` },
    openGraph: {
      title,
      description,
      url: `https://www.playchess.tech/position/${referenceId}`,
      siteName: "ReplayChess",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function PositionPage({ params }: { params: Promise<{ referenceId: string }> }) {
  return <PositionPageClient params={params} />;
}
