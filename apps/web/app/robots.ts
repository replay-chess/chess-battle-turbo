import { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Indexing decisions live in page metadata. These paths are blocked only
      // because they are non-content infrastructure or unbounded session URLs.
      disallow: [
        "/api/",
        "/admin/",
        "/monitoring",
        "/game/",
        "/analysis/",
        "/join/",
        "/join-tournament/",
        "/queue",
        "/position/",
        "/tournament/",
        "/try/game/",
        "/try/analysis/",
      ],
    },
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
