import { createMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = createMetadata({
  title: "ReplayChess Community Updates",
  description:
    "Follow ReplayChess development, read new chess lessons, share feedback, and find the official channels for community updates.",
  path: "/community",
  noIndex: true,
  noFollow: false,
});

export default function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
