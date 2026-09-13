import { prisma } from "@/lib/prisma";
import { BASE_URL } from "@/lib/seo";
import { sitemapResponse } from "@/lib/sitemaps";

// Never prerender at build (no DB there); Vercel's CDN caches the response via s-maxage.
export const dynamic = "force-dynamic";

export async function GET() {
  const legends = await prisma.legend.findMany({
    where: { isActive: true, isVisible: true },
    select: { referenceId: true, updatedAt: true },
    orderBy: { name: "asc" },
  });

  return sitemapResponse(
    legends.map((legend) => ({
      loc: `${BASE_URL}/legends/${legend.referenceId}`,
      lastmod: legend.updatedAt,
      changefreq: "monthly" as const,
      priority: 0.7,
    })),
  );
}
