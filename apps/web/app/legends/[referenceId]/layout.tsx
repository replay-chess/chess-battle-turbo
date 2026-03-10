import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";

interface Props {
  params: Promise<{ referenceId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { referenceId } = await params;
  const legend = await prisma.legend.findUnique({
    where: { referenceId },
    select: { name: true, shortDescription: true, peakRating: true, era: true, profilePhotoUrl: true },
  });

  if (!legend) {
    return { title: "Legend Not Found", robots: { index: false, follow: false } };
  }

  const title = `${legend.name}${legend.peakRating ? ` (${legend.peakRating})` : ""} — Chess Legend`;
  const description = legend.shortDescription;
  const ogImageUrl = `/og?title=${encodeURIComponent(legend.name)}&subtitle=${encodeURIComponent(legend.era)}&type=legend`;

  return {
    title,
    description,
    alternates: { canonical: `https://www.playchess.tech/legends/${referenceId}` },
    openGraph: {
      title,
      description,
      url: `https://www.playchess.tech/legends/${referenceId}`,
      siteName: "ReplayChess",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: legend.name }],
      type: "profile",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export default function LegendDetailLayout({ children }: { children: React.ReactNode }) {
  return children;
}
