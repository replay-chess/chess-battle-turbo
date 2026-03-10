import { cache } from "react";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { safeJsonLd } from "@/lib/seo";

interface Props {
  params: Promise<{ referenceId: string }>;
  children: React.ReactNode;
}

const getUser = cache(async (referenceId: string) => {
  return prisma.user.findUnique({
    where: { referenceId },
    select: { name: true, code: true, profilePictureUrl: true },
  });
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { referenceId } = await params;
  const user = await getUser(referenceId);

  if (!user) {
    return { title: "Player Not Found", robots: { index: false, follow: false } };
  }

  const title = `${user.name} (${user.code})`;
  const description = `View ${user.name}'s chess profile, stats, and game history on ReplayChess.`;

  return {
    title,
    description,
    alternates: { canonical: `https://www.playchess.tech/profile/${referenceId}` },
    openGraph: {
      title,
      description,
      url: `https://www.playchess.tech/profile/${referenceId}`,
      siteName: "ReplayChess",
      ...(user.profilePictureUrl && {
        images: [{ url: user.profilePictureUrl, width: 200, height: 200, alt: user.name }],
      }),
      type: "profile",
    },
    twitter: {
      card: "summary",
      title,
      description,
      ...(user.profilePictureUrl && { images: [user.profilePictureUrl] }),
    },
  };
}

async function ProfileJsonLd({ params }: { params: Promise<{ referenceId: string }> }) {
  const { referenceId } = await params;
  const user = await getUser(referenceId);

  if (!user) return null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: user.name,
    url: `https://www.playchess.tech/profile/${referenceId}`,
    ...(user.profilePictureUrl && { image: user.profilePictureUrl }),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
    />
  );
}

export default async function ProfileLayout({ params, children }: Props) {
  return (
    <>
      <ProfileJsonLd params={params} />
      {children}
    </>
  );
}
