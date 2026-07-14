import Link from "next/link";
import { BLOG_CATEGORIES, type BlogCategory } from "@/lib/blog-types";

export function CategoryNav({ active }: { active?: BlogCategory }) {
  return (
    <nav
      aria-label="Blog categories"
      className="flex flex-wrap justify-center gap-2"
    >
      <Link
        href="/blog"
        aria-current={!active ? "page" : undefined}
        className={`border px-4 py-2 font-sans text-xs uppercase tracking-[0.14em] transition-colors ${
          !active
            ? "border-cb-accent bg-cb-accent text-cb-accent-fg"
            : "border-cb-border text-cb-text-muted hover:border-cb-border-strong hover:text-cb-text"
        }`}
      >
        All articles
      </Link>
      {Object.entries(BLOG_CATEGORIES).map(([slug, category]) => (
        <Link
          key={slug}
          href={`/blog/category/${slug}`}
          aria-current={active === slug ? "page" : undefined}
          className={`border px-4 py-2 font-sans text-xs uppercase tracking-[0.14em] transition-colors ${
            active === slug
              ? "border-cb-accent bg-cb-accent text-cb-accent-fg"
              : "border-cb-border text-cb-text-muted hover:border-cb-border-strong hover:text-cb-text"
          }`}
        >
          {category.label}
        </Link>
      ))}
    </nav>
  );
}
