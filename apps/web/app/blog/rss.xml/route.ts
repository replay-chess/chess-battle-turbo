import { getBlogPosts } from "@/lib/blog";
import { BASE_URL } from "@/lib/seo";

export const dynamic = "force-static";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export async function GET() {
  const posts = await getBlogPosts();
  const items = posts
    .map((post) => {
      const url = `${BASE_URL}/blog/${post.slug}`;
      return `
      <item>
        <title>${escapeXml(post.title)}</title>
        <link>${url}</link>
        <guid isPermaLink="true">${url}</guid>
        <description>${escapeXml(post.description)}</description>
        <pubDate>${new Date(`${post.publishedAt}T00:00:00Z`).toUTCString()}</pubDate>
      </item>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
    <rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
      <channel>
        <title>ReplayChess Journal</title>
        <link>${BASE_URL}/blog</link>
        <description>Practical chess strategy, opening ideas, and famous games.</description>
        <language>en</language>
        <atom:link href="${BASE_URL}/blog/rss.xml" rel="self" type="application/rss+xml" />
        ${items}
      </channel>
    </rss>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control":
        "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
