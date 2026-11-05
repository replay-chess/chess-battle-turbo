import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Join Tournament",
  description: "Join a chess tournament on ReplayChess.",
  path: "/join-tournament",
  noIndex: true,
});

export default function JoinTournamentLayout({ children }: { children: React.ReactNode }) {
  return children;
}
