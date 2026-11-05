import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Play Chess",
  description:
    "Start a game — quick match, challenge friends, or play against AI on ReplayChess.",
  path: "/play",
});

export default function PlayLayout({ children }: { children: React.ReactNode }) {
  return children;
}
