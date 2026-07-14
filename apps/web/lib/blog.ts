import "server-only";

import { cache } from "react";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  BLOG_CATEGORIES,
  type BlogAuthor,
  type BlogCategory,
  type BlogPostMetadata,
  type BlogPostSummary,
} from "@/lib/blog-types";

const CONTENT_DIRECTORY = path.join(process.cwd(), "content", "blog");
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORDS_PER_MINUTE = 225;

const imageSchema = z.object({
  src: z.string().startsWith("/"),
  alt: z.string().trim().min(8),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const metadataSchema = z.object({
  title: z.string().trim().min(10).max(110),
  description: z.string().trim().min(50).max(180),
  publishedAt: z.iso.date(),
  updatedAt: z.iso.date().optional(),
  category: z.enum(
    Object.keys(BLOG_CATEGORIES) as [BlogCategory, ...BlogCategory[]],
  ),
  authorId: z.string().trim().min(1),
  heroImage: imageSchema,
  tags: z.array(z.string().trim().min(1)).max(8).optional(),
  featured: z.boolean().optional(),
  draft: z.boolean().optional(),
});

export const BLOG_AUTHORS: Record<string, BlogAuthor> = {
  "rohit-pandit": {
    id: "rohit-pandit",
    name: "Rohit Pandit",
    bio: "A chess nerd trying to turn chess lovers into chess nerds.",
    profilePath: "/blog/author/rohit-pandit",
    socialUrl: "https://x.com/anaestheticdev",
    image: {
      src: "/images/authors/rohit-pandit.webp",
      alt: "Rohit Pandit, author at ReplayChess",
      width: 512,
      height: 512,
    },
  },
};

type MdxModule = {
  default: React.ComponentType;
  metadata?: unknown;
};

export interface BlogPost extends BlogPostSummary {
  Content: React.ComponentType;
}

function isPublished(metadata: BlogPostMetadata): boolean {
  return !metadata.draft;
}

function assertKnownAuthor(authorId: string, slug: string) {
  if (!BLOG_AUTHORS[authorId]) {
    throw new Error(
      `Blog post "${slug}" references unknown author "${authorId}".`,
    );
  }
}

async function getAllSlugs(): Promise<string[]> {
  const files = await readdir(CONTENT_DIRECTORY);
  const slugs = files
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => file.slice(0, -4));

  const invalidSlug = slugs.find((slug) => !SLUG_PATTERN.test(slug));
  if (invalidSlug) {
    throw new Error(
      `Invalid blog slug "${invalidSlug}". Use lowercase kebab-case filenames.`,
    );
  }

  if (new Set(slugs).size !== slugs.length) {
    throw new Error("Duplicate blog slugs found in content/blog.");
  }

  return slugs;
}

async function importPostModule(slug: string): Promise<MdxModule | null> {
  if (!SLUG_PATTERN.test(slug)) return null;

  try {
    return (await import(`@/content/blog/${slug}.mdx`)) as MdxModule;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "MODULE_NOT_FOUND" || code === "ENOENT") return null;
    throw error;
  }
}

function validateMetadata(slug: string, metadata: unknown): BlogPostMetadata {
  const parsed = metadataSchema.safeParse(metadata);
  if (!parsed.success) {
    throw new Error(
      `Invalid metadata in content/blog/${slug}.mdx:\n${z.prettifyError(parsed.error)}`,
    );
  }

  if (
    parsed.data.updatedAt &&
    parsed.data.updatedAt < parsed.data.publishedAt
  ) {
    throw new Error(`Blog post "${slug}" has updatedAt before publishedAt.`);
  }

  assertKnownAuthor(parsed.data.authorId, slug);
  return parsed.data;
}

function calculateReadTime(source: string): string {
  const prose = source
    .replace(/^export\s+const\s+metadata\s*=\s*\{[\s\S]*?^\};?\s*$/m, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_>`~[\](){}|-]/g, " ");
  const words = prose.trim().split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.ceil(words / WORDS_PER_MINUTE))} min read`;
}

async function readSource(slug: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path.join(CONTENT_DIRECTORY, `${slug}.mdx`), "utf8");
}

export const getBlogPostBySlug = cache(
  async (slug: string, includeDraft = false): Promise<BlogPost | null> => {
    const postModule = await importPostModule(slug);
    if (!postModule) return null;

    const metadata = validateMetadata(slug, postModule.metadata);
    if (!includeDraft && !isPublished(metadata)) return null;

    return {
      ...metadata,
      slug,
      readTime: calculateReadTime(await readSource(slug)),
      Content: postModule.default,
    };
  },
);

export const getBlogPosts = cache(async (): Promise<BlogPostSummary[]> => {
  const slugs = await getAllSlugs();
  const posts = await Promise.all(
    slugs.map(async (slug) => {
      const postModule = await importPostModule(slug);
      if (!postModule) throw new Error(`Could not import blog post "${slug}".`);
      const metadata = validateMetadata(slug, postModule.metadata);
      if (!isPublished(metadata)) return null;
      return {
        ...metadata,
        slug,
        readTime: calculateReadTime(await readSource(slug)),
      } satisfies BlogPostSummary;
    }),
  );

  return posts
    .filter((post): post is BlogPostSummary => post !== null)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
});

export async function getFeaturedBlogPost(): Promise<BlogPostSummary | null> {
  const posts = await getBlogPosts();
  return posts.find((post) => post.featured) ?? posts[0] ?? null;
}

export async function getPostsByCategory(category: BlogCategory) {
  return (await getBlogPosts()).filter((post) => post.category === category);
}

export async function getPostsByAuthor(authorId: string) {
  return (await getBlogPosts()).filter((post) => post.authorId === authorId);
}

export async function getRelatedPosts(post: BlogPostSummary, limit = 3) {
  const tags = new Set(post.tags ?? []);
  return (await getBlogPosts())
    .filter((candidate) => candidate.slug !== post.slug)
    .map((candidate) => ({
      post: candidate,
      score:
        (candidate.category === post.category ? 10 : 0) +
        (candidate.tags ?? []).filter((tag) => tags.has(tag)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.post.publishedAt.localeCompare(a.post.publishedAt),
    )
    .slice(0, limit)
    .map(({ post: candidate }) => candidate);
}

export function isBlogCategory(value: string): value is BlogCategory {
  return value in BLOG_CATEGORIES;
}

export function getBlogAuthor(authorId: string): BlogAuthor {
  const author = BLOG_AUTHORS[authorId];
  if (!author) throw new Error(`Unknown blog author "${authorId}".`);
  return author;
}
