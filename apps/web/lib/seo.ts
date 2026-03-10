import type { Metadata } from "next";

export const BASE_URL = "https://www.playchess.tech";

/** Escapes </script> sequences to prevent XSS in JSON-LD script tags */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

interface CreateMetadataOptions {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  noIndex?: boolean;
  ogType?: "legend" | "opening" | "blog" | "profile";
  ogTitle?: string;
}

export function createMetadata({
  title,
  description,
  path,
  ogImage,
  noIndex = false,
  ogType,
  ogTitle,
}: CreateMetadataOptions): Metadata {
  const url = `${BASE_URL}${path}`;

  const resolvedOgImage = ogImage
    ?? (ogType && ogTitle
      ? `/og?title=${encodeURIComponent(ogTitle)}&type=${encodeURIComponent(ogType)}`
      : "/og-image.jpg");

  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      siteName: "ReplayChess",
      images: [{ url: resolvedOgImage, width: 1200, height: 630, alt: title }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [resolvedOgImage],
    },
    ...(noIndex && { robots: { index: false, follow: false } }),
  };
}
