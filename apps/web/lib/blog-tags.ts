import type { BlogPostSummary, BlogTagSummary } from "@/lib/blog-types";

export function normalizeBlogTag(tag: string): string {
  return tag.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function getBlogTagHref(tag: string): string {
  const params = new URLSearchParams({ tag: normalizeBlogTag(tag) });
  return `/blog?${params.toString()}`;
}

export function summarizeBlogTags(
  posts: readonly Pick<BlogPostSummary, "tags">[],
): BlogTagSummary[] {
  const summaries = new Map<string, BlogTagSummary>();

  for (const post of posts) {
    const seenForPost = new Set<string>();

    for (const label of post.tags) {
      const value = normalizeBlogTag(label);
      if (!value || seenForPost.has(value)) continue;
      seenForPost.add(value);

      const existing = summaries.get(value);
      if (existing) {
        existing.count += 1;
      } else {
        summaries.set(value, { value, label, count: 1 });
      }
    }
  }

  return [...summaries.values()].sort((a, b) =>
    a.label.localeCompare(b.label, "en", { sensitivity: "base" }),
  );
}

export function filterBlogPostsByTag<T extends Pick<BlogPostSummary, "tags">>(
  posts: readonly T[],
  tag: string,
): T[] {
  const requestedTag = normalizeBlogTag(tag);
  if (!requestedTag) return [];

  return posts.filter((post) =>
    post.tags.some((candidate) => normalizeBlogTag(candidate) === requestedTag),
  );
}
