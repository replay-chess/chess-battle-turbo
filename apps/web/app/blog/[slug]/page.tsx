import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { AuthorCard } from "@/app/blog/_components/AuthorCard";
import { BlogCard, formatBlogDate } from "@/app/blog/_components/BlogCard";
import { ArticleStockfishProvider } from "@/app/blog/_components/ArticleStockfishProvider";
import { BLOG_CATEGORIES } from "@/lib/blog-types";
import {
  getBlogAuthor,
  getBlogPostBySlug,
  getBlogPosts,
  getRelatedPosts,
} from "@/lib/blog";
import { BASE_URL, safeJsonLd } from "@/lib/seo";

interface Props {
  params: Promise<{ slug: string }>;
}

const previewDrafts =
  process.env.NODE_ENV === "development" &&
  process.env.BLOG_PREVIEW_DRAFTS === "true";

export async function generateStaticParams() {
  return (await getBlogPosts()).map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug, previewDrafts);
  if (!post)
    return {
      title: "Article Not Found",
      robots: { index: false, follow: false },
    };

  const canonical = `${BASE_URL}/blog/${post.slug}`;
  return {
    title: post.title,
    description: post.description,
    authors: [
      {
        name: getBlogAuthor(post.authorId).name,
        url: `${BASE_URL}${getBlogAuthor(post.authorId).profilePath}`,
      },
    ],
    alternates: {
      canonical,
      types: { "application/rss+xml": `${BASE_URL}/blog/rss.xml` },
    },
    openGraph: {
      title: post.title,
      description: post.description,
      url: canonical,
      siteName: "ReplayChess",
      type: "article",
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt,
      authors: [getBlogAuthor(post.authorId).name],
      tags: post.tags,
      images: [
        {
          url: post.heroImage.src,
          width: post.heroImage.width,
          height: post.heroImage.height,
          alt: post.heroImage.alt,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [post.heroImage.src],
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getBlogPostBySlug(slug, previewDrafts);
  if (!post) notFound();

  const author = getBlogAuthor(post.authorId);
  const relatedPosts = await getRelatedPosts(post);
  const canonical = `${BASE_URL}/blog/${post.slug}`;
  const published = `${post.publishedAt}T00:00:00+00:00`;
  const modified = `${post.updatedAt ?? post.publishedAt}T00:00:00+00:00`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    datePublished: published,
    dateModified: modified,
    image: {
      "@type": "ImageObject",
      url: `${BASE_URL}${post.heroImage.src}`,
      width: post.heroImage.width,
      height: post.heroImage.height,
    },
    author: {
      "@type": "Person",
      name: author.name,
      url: `${BASE_URL}${author.profilePath}`,
      sameAs: [author.socialUrl],
      image: `${BASE_URL}${author.image.src}`,
    },
    publisher: {
      "@type": "Organization",
      name: "ReplayChess",
      url: BASE_URL,
      logo: { "@type": "ImageObject", url: `${BASE_URL}/chess-logo-bnw.png` },
    },
    articleSection: BLOG_CATEGORIES[post.category].label,
    keywords: post.tags?.join(", "),
  };

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar breadcrumbLabel={post.title} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      <main>
        <article>
          <header className="mx-auto max-w-4xl px-4 pb-10 pt-32 sm:px-6 sm:pt-40">
            <Link
              href="/blog"
              className="font-sans text-xs uppercase tracking-[0.16em] text-cb-text-muted transition-colors hover:text-cb-text"
            >
              ← All articles
            </Link>
            <div className="mt-9 flex flex-wrap items-center gap-3 font-sans text-[10px] uppercase tracking-[0.14em] text-cb-text-muted">
              <Link
                href={`/blog/category/${post.category}`}
                className="border border-cb-border px-2 py-1 text-cb-text-secondary hover:border-cb-border-strong"
              >
                {BLOG_CATEGORIES[post.category].label}
              </Link>
              <span>{post.readTime}</span>
            </div>
            <h1 className="mt-5 font-serif text-4xl leading-[1.08] text-cb-text sm:text-5xl md:text-6xl">
              {post.title}
            </h1>
            <p className="mt-5 max-w-3xl font-sans text-lg leading-8 text-cb-text-muted">
              {post.description}
            </p>
            <div className="mt-7 flex items-center gap-3">
              <Image
                src={author.image.src}
                alt={author.image.alt}
                width={40}
                height={40}
                className="h-10 w-10 rounded-full object-cover"
              />
              <div className="font-sans text-xs leading-5 text-cb-text-muted">
                <Link
                  href={author.profilePath}
                  className="text-cb-text-secondary underline decoration-cb-border-strong underline-offset-4"
                >
                  {author.name}
                </Link>
                <p>
                  <time dateTime={published}>
                    {formatBlogDate(post.publishedAt)}
                  </time>
                  {post.updatedAt && (
                    <>
                      {" "}
                      · Updated{" "}
                      <time dateTime={modified}>
                        {formatBlogDate(post.updatedAt)}
                      </time>
                    </>
                  )}
                </p>
              </div>
            </div>
          </header>

          <div className="relative mx-auto aspect-[16/9] max-w-6xl overflow-hidden border-y border-cb-border sm:border">
            <Image
              src={post.heroImage.src}
              alt={post.heroImage.alt}
              fill
              priority
              sizes="(max-width: 1152px) 100vw, 1152px"
              className="object-cover"
            />
          </div>

          <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="blog-prose">
              <ArticleStockfishProvider>
                <post.Content />
              </ArticleStockfishProvider>
            </div>
            <AuthorCard author={author} />
          </div>
        </article>

        {relatedPosts.length > 0 && (
          <section
            className="border-t border-cb-border px-6 py-16"
            aria-labelledby="related-articles"
          >
            <div className="mx-auto max-w-7xl">
              <h2
                id="related-articles"
                className="mb-7 font-serif text-3xl text-cb-text"
              >
                Continue learning
              </h2>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {relatedPosts.map((related) => (
                  <BlogCard key={related.slug} post={related} />
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
