import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Chess Legends",
  description:
    "Explore profiles of history's greatest chess players — from Morphy and Capablanca to Fischer and Carlsen.",
  path: "/legends",
  noIndex: true,
  ogType: "legend",
  ogTitle: "Chess Legends",
});

export default function LegendsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
