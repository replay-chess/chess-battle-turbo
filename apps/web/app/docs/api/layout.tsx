import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "ReplayChess API Preview",
  description:
    "Preview the planned ReplayChess API and contact the team about future access to chess positions, game data, and analysis tools.",
  path: "/docs/api",
  noIndex: true,
  noFollow: false,
});

export default function ApiDocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
