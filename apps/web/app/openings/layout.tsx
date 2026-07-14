import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Chess Openings",
  description:
    "Browse hundreds of chess openings organized by ECO code. Study move sequences, positions, and play from any opening.",
  path: "/openings",
  noIndex: true,
  ogType: "opening",
  ogTitle: "Chess Openings",
});

export default function OpeningsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
