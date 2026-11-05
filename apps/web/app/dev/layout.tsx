import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devRoutesEnabled } from "@/lib/env";

export const metadata: Metadata = {
  title: "Dev",
  robots: { index: false, follow: false },
};

/** `/dev/**` fails closed (SPEC D11): 404 unless devRoutesEnabled(). */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (!devRoutesEnabled()) notFound();
  return children;
}
