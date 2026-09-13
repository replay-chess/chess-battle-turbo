import { prisma } from "@/lib/prisma";
import { BASE_URL } from "@/lib/seo";
import { sitemapResponse } from "@/lib/sitemaps";

// Never prerender at build (no DB there); Vercel's CDN caches the response via s-maxage.
export const dynamic = "force-dynamic";

export async function GET() {
  const openings = await prisma.opening.findMany({
    where: { isActive: true },
    select: { referenceId: true, updatedAt: true, explanation: true },
    orderBy: [{ eco: "asc" }, { name: "asc" }],
  });

  return sitemapResponse(
    openings.map((opening) => ({
      loc: `${BASE_URL}/openings/${opening.referenceId}`,
      lastmod: opening.updatedAt,
      changefreq: "monthly" as const,
      // Openings with narrated explanations are the richest pages; crawl them first.
      priority: opening.explanation ? 0.7 : 0.5,
    })),
  );
}
