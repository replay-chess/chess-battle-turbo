import { MetadataRoute } from "next";
import { BLOG_CATEGORIES } from "@/lib/blog-types";
import { BLOG_AUTHORS, getBlogPosts } from "@/lib/blog";
import { BASE_URL } from "@/lib/seo";
import {
  ECO_FAMILIES,
  buildOpeningSlug,
  getCanonicalOpenings,
  getVisibleLegends,
  slugifyName,
} from "@/lib/learn-directory";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const blogPosts = await getBlogPosts();

  // Public reference pages backed by the database. Fail-soft: a build
  // environment without database access still produces a valid sitemap
  // containing every static page.
  const [openings, legends] = await Promise.all([
    getCanonicalOpenings().catch(() => []),
    getVisibleLegends().catch(() => []),
  ]);

  const ecoFamilyPages: MetadataRoute.Sitemap = ECO_FAMILIES.filter((family) =>
    openings.some((opening) => opening.eco.charAt(0) === family.letter),
  ).map((family) => ({
    url: `${BASE_URL}/learn/openings/eco/${family.letter.toLowerCase()}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const openingPages: MetadataRoute.Sitemap = openings.map((opening) => ({
    url: `${BASE_URL}/learn/openings/${buildOpeningSlug(opening.name, opening.eco)}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const legendPages: MetadataRoute.Sitemap = legends.map((legend) => ({
    url: `${BASE_URL}/learn/legends/${slugifyName(legend.name)}`,
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, changeFrequency: "weekly", priority: 1.0 },
    { url: `${BASE_URL}/try`, changeFrequency: "weekly", priority: 0.9 },
    {
      url: `${BASE_URL}/learn/openings`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/learn/legends`,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    { url: `${BASE_URL}/pricing`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/blog`, changeFrequency: "weekly", priority: 0.8 },
    // legends and openings excluded — auth-gated to prevent scraping
    { url: `${BASE_URL}/about`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE_URL}/help`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/contact`, changeFrequency: "monthly", priority: 0.5 },
    {
      url: `${BASE_URL}/blog/editorial-policy`,
      changeFrequency: "yearly",
      priority: 0.4,
    },
    { url: `${BASE_URL}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE_URL}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${BASE_URL}/cookies`, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Blog post pages
  const blogPages: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${BASE_URL}/blog/${post.slug}`,
    lastModified: new Date(`${post.updatedAt ?? post.publishedAt}T00:00:00Z`),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  const categoryPages: MetadataRoute.Sitemap = Object.keys(BLOG_CATEGORIES)
    .filter(
      (category) =>
        blogPosts.filter((post) => post.category === category).length >= 2,
    )
    .map((category) => ({
      url: `${BASE_URL}/blog/category/${category}`,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    }));

  const authorPages: MetadataRoute.Sitemap = Object.values(BLOG_AUTHORS)
    .filter((author) => blogPosts.some((post) => post.authorId === author.id))
    .map((author) => ({
      url: `${BASE_URL}${author.profilePath}`,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    }));

  // NOTE: The auth-gated app pages (/openings, /legends, /profile) stay out
  // of the sitemap. Their public, indexable counterparts live under /learn
  // and are included above via ecoFamilyPages, openingPages, and legendPages.

  return [
    ...staticPages,
    ...ecoFamilyPages,
    ...categoryPages,
    ...authorPages,
    ...blogPages,
    ...legendPages,
    ...openingPages,
  ];
}
