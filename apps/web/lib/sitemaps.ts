import { BASE_URL } from "@/lib/seo";

/**
 * Catalogue sitemaps are served as plain route handlers rather than through
 * Next's generateSitemaps(), which would move the core /sitemap.xml to
 * /sitemap/0.xml and break the URL already registered in Search Console.
 * Keeping one file per catalogue also gives per-catalogue indexation reports.
 */
export const CATALOGUE_SITEMAPS = [
  `${BASE_URL}/sitemap-legends.xml`,
  `${BASE_URL}/sitemap-openings.xml`,
] as const;

export interface SitemapEntry {
  loc: string;
  lastmod?: Date;
  changefreq?: "daily" | "weekly" | "monthly" | "yearly";
  priority?: number;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderSitemap(entries: SitemapEntry[]): string {
  const body = entries
    .map((entry) => {
      const parts = [`<loc>${escapeXml(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`<lastmod>${entry.lastmod.toISOString()}</lastmod>`);
      if (entry.changefreq) parts.push(`<changefreq>${entry.changefreq}</changefreq>`);
      if (entry.priority !== undefined) parts.push(`<priority>${entry.priority}</priority>`);
      return `<url>${parts.join("")}</url>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

export function sitemapResponse(entries: SitemapEntry[]): Response {
  return new Response(renderSitemap(entries), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
