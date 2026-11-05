// /too-many-requests (plan §4.8; V3RateLimited `page`): where a rate-limited document request lands (Vercel Firewall
// rule, or the middleware edge limiter with EDGE_DOC_LIMIT=on) and the direct-visit form
// `/too-many-requests?retry=<sec>&from=<path>`. Public, static, marketing chrome, noindex.
import type { Metadata } from "next";
import { Suspense } from "react";
import { Footer } from "../components/Footer";
import { Navbar } from "../components/Navbar";
import { TooManyRequestsClient, TooManyRequestsView } from "./TooManyRequestsClient";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Too Many Requests",
  robots: { index: false, follow: false },
};

export default function TooManyRequestsPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-cb-bg text-cb-text">
      <Navbar />
      <main className="flex flex-1 flex-col items-center justify-center px-4 pt-28 pb-16 sm:px-8 sm:pt-32">
        {/* The query is read on the client (the page is static); the fallback is the default 0:30 state. */}
        <Suspense fallback={<TooManyRequestsView left={30} />}>
          <TooManyRequestsClient />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
