import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Matchmaking",
  description: "Finding your next opponent on ReplayChess.",
  path: "/queue",
  noIndex: true,
});

export default function QueueLayout({ children }: { children: React.ReactNode }) {
  return children;
}
