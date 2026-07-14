import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "Chess Game, Account and Billing Help",
  description:
    "Get practical help with ReplayChess position challenges, accounts, subscriptions, game links, analysis, and technical issues, with direct support when needed.",
  path: "/help",
});

export default function HelpLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
