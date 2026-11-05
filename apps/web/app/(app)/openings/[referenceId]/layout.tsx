import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";

interface Props {
  params: Promise<{ referenceId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { referenceId } = await params;
  const opening = await prisma.opening.findUnique({
    where: { referenceId },
    select: { name: true, eco: true, pgn: true },
  });

  if (!opening) {
    return { title: "Opening Not Found", robots: { index: false, follow: false } };
  }

  const title = `${opening.name} (${opening.eco})`;
  const description = `Study the ${opening.name} chess opening (${opening.eco}): ${opening.pgn}. Play from this position on ReplayChess.`;
  const ogImageUrl = `/og?title=${encodeURIComponent(opening.name)}&subtitle=${encodeURIComponent(opening.eco)}&type=opening`;

  return {
    title,
    description,
    alternates: { canonical: `https://www.playchess.tech/openings/${referenceId}` },
    openGraph: {
      title,
      description,
      url: `https://www.playchess.tech/openings/${referenceId}`,
      siteName: "ReplayChess",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: opening.name }],
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function OpeningDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
