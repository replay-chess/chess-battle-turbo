import Link from "next/link";
import type { BlogTagSummary } from "@/lib/blog-types";
import { getBlogTagHref } from "@/lib/blog-tags";

export function TagFilter({
  tags,
  activeTag,
  hasSelection = false,
}: {
  tags: BlogTagSummary[];
  activeTag?: string;
  hasSelection?: boolean;
}) {
  return (
    <nav aria-label="Filter articles by tag">
      <p className="mb-3 text-center font-sans text-[10px] uppercase tracking-[0.2em] text-cb-text-muted">
        Filter by topic
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          href="/blog"
          aria-current={!hasSelection ? "page" : undefined}
          className={`border px-3 py-1.5 font-sans text-xs transition-colors ${
            !hasSelection
              ? "border-cb-text bg-cb-text text-cb-bg"
              : "border-cb-border text-cb-text-muted hover:border-cb-border-strong hover:text-cb-text"
          }`}
        >
          All topics
        </Link>
        {tags.map((tag) => {
          const active = activeTag === tag.value;
          return (
            <Link
              key={tag.value}
              href={getBlogTagHref(tag.value)}
              aria-current={active ? "page" : undefined}
              aria-label={`${tag.label}: ${tag.count} ${tag.count === 1 ? "article" : "articles"}`}
              className={`border px-3 py-1.5 font-sans text-xs transition-colors ${
                active
                  ? "border-cb-text bg-cb-text text-cb-bg"
                  : "border-cb-border text-cb-text-muted hover:border-cb-border-strong hover:text-cb-text"
              }`}
            >
              {tag.label}
              <span className="ml-1.5 text-[10px] opacity-65">{tag.count}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
