import { BASE_URL, createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = {
  ...createMetadata({
    title: "Chess Strategy, Openings and Famous Games",
    description:
      "Practical chess strategy, opening plans, pawn structures, and famous games explained for players who want to understand the reasons behind strong moves.",
    path: "/blog",
  }),
  title: {
    default: "Chess Strategy, Openings and Famous Games",
    template: "%s | ReplayChess",
  },
  alternates: {
    canonical: `${BASE_URL}/blog`,
    types: { "application/rss+xml": `${BASE_URL}/blog/rss.xml` },
  },
};

export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
