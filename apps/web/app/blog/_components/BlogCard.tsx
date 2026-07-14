import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BLOG_CATEGORIES, type BlogPostSummary } from "@/lib/blog-types";
import { getBlogAuthor } from "@/lib/blog";

export function formatBlogDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function BlogCard({
  post,
  featured = false,
}: {
  post: BlogPostSummary;
  featured?: boolean;
}) {
  const author = getBlogAuthor(post.authorId);

  return (
    <article className="group h-full border border-cb-border bg-cb-bg transition-colors duration-300 hover:border-cb-border-strong">
      <Link href={`/blog/${post.slug}`} className="flex h-full flex-col">
        <div
          className={
            featured
              ? "relative aspect-[21/9] overflow-hidden"
              : "relative aspect-[16/9] overflow-hidden"
          }
        >
          <Image
            src={post.heroImage.src}
            alt={post.heroImage.alt}
            fill
            priority={featured}
            sizes={
              featured
                ? "(max-width: 1280px) 100vw, 1280px"
                : "(max-width: 768px) 100vw, 33vw"
            }
            className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-transparent" />
          {featured && (
            <span className="absolute left-5 top-5 border border-white/30 bg-black/35 px-3 py-1 font-sans text-[10px] uppercase tracking-[0.2em] text-white backdrop-blur-sm">
              Featured
            </span>
          )}
        </div>

        <div
          className={
            featured
              ? "flex flex-1 flex-col p-6 sm:p-8"
              : "flex flex-1 flex-col p-5 sm:p-6"
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-3 font-sans text-[10px] uppercase tracking-[0.14em] text-cb-text-muted">
            <span className="border border-cb-border px-2 py-1 text-cb-text-secondary">
              {BLOG_CATEGORIES[post.category].label}
            </span>
            <span>{post.readTime}</span>
          </div>

          <h2
            className={
              featured
                ? "font-serif text-3xl leading-tight text-cb-text sm:text-4xl"
                : "font-serif text-2xl leading-tight text-cb-text"
            }
          >
            {post.title}
          </h2>
          <p className="mt-3 flex-1 font-sans text-sm leading-6 text-cb-text-muted">
            {post.description}
          </p>

          <div className="mt-6 flex items-center justify-between gap-4 border-t border-cb-border pt-4">
            <div className="flex min-w-0 items-center gap-3">
              <Image
                src={author.image.src}
                alt={author.image.alt}
                width={32}
                height={32}
                className="h-8 w-8 rounded-full object-cover"
              />
              <div className="min-w-0 font-sans text-[11px] text-cb-text-muted">
                <p className="truncate text-cb-text-secondary">{author.name}</p>
                <time dateTime={post.publishedAt}>
                  {formatBlogDate(post.publishedAt)}
                </time>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-cb-text-faint transition-transform group-hover:translate-x-1 group-hover:text-cb-text" />
          </div>
        </div>
      </Link>
    </article>
  );
}
