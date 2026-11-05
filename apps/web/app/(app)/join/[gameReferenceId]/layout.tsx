import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "You've Been Challenged!",
  description: "Accept a chess challenge and join the battle on ReplayChess.",
  path: "/join",
  noIndex: true,
});

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return children;
}
