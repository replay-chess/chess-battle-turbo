import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Chess Openings",
  description:
    "Browse 3,600+ chess openings organized by ECO code. See the moves, the resulting position, and play from any opening on ReplayChess.",
  path: "/openings",
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
