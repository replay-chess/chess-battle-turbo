import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Position Challenge",
  description: "Play this chess position on ReplayChess.",
  robots: { index: false, follow: true },
};

export default function TryPositionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
