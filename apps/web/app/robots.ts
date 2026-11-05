import { MetadataRoute } from "next";
import { BASE_URL } from "@/lib/seo";
import { ROBOTS_DISALLOW } from "@/lib/seo/robots-rules";
import { CATALOGUE_SITEMAPS } from "@/lib/sitemaps";

// The Disallow list lives in lib/seo/robots-rules/ (one file per phase).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...ROBOTS_DISALLOW],
    },
    sitemap: [`${BASE_URL}/sitemap.xml`, ...CATALOGUE_SITEMAPS],
  };
}
