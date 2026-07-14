import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Demo Chess Game",
  description: "A temporary ReplayChess demo game.",
  robots: { index: false, follow: false },
};

export default function TryGameLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
