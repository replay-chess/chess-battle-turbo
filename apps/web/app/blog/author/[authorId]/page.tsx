import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { BlogCard } from "@/app/blog/_components/BlogCard";
import { BLOG_AUTHORS, getBlogAuthor, getPostsByAuthor } from "@/lib/blog";
import { BASE_URL, safeJsonLd } from "@/lib/seo";

interface Props {
  params: Promise<{ authorId: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(BLOG_AUTHORS).map((authorId) => ({ authorId }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { authorId } = await params;
  const author = BLOG_AUTHORS[authorId];
  if (!author) return { title: "Author Not Found", robots: { index: false } };

  const canonical = `${BASE_URL}${author.profilePath}`;
  return {
    title: `${author.name}, ReplayChess Author`,
    description:
      "Meet Rohit Pandit, the maker and author behind ReplayChess, and browse his practical lessons on chess strategy, famous games, openings, and improvement.",
    alternates: { canonical },
    openGraph: {
      title: `${author.name}, ReplayChess Author`,
      description: author.bio,
      url: canonical,
      siteName: "ReplayChess",
      type: "profile",
      images: [
        {
          url: author.image.src,
          width: author.image.width,
          height: author.image.height,
          alt: author.image.alt,
        },
      ],
    },
    twitter: {
      card: "summary",
      title: `${author.name}, ReplayChess Author`,
      description: author.bio,
      images: [author.image.src],
    },
  };
}

export default async function AuthorPage({ params }: Props) {
  const { authorId } = await params;
  if (!BLOG_AUTHORS[authorId]) notFound();

  const author = getBlogAuthor(authorId);
  const posts = await getPostsByAuthor(authorId);
  const canonical = `${BASE_URL}${author.profilePath}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": canonical,
    url: canonical,
    mainEntity: {
      "@type": "Person",
      name: author.name,
      image: `${BASE_URL}${author.image.src}`,
      description: author.bio,
      url: canonical,
      sameAs: [author.socialUrl],
      worksFor: { "@id": `${BASE_URL}/#organization` },
    },
  };

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar breadcrumbLabel={author.name} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />
      <main>
        <header className="border-b border-cb-border px-6 pb-16 pt-32 sm:pt-40">
          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[160px_1fr] md:items-center">
            <Image
              src={author.image.src}
              alt={author.image.alt}
              width={160}
              height={160}
              priority
              className="h-32 w-32 rounded-full object-cover md:h-40 md:w-40"
            />
            <div>
              <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-cb-text-muted">
                Author and maker
              </p>
              <h1 className="mt-3 font-serif text-5xl sm:text-6xl">
                {author.name}
              </h1>
              <p className="mt-4 max-w-2xl font-sans text-base leading-7 text-cb-text-muted">
                {author.bio} Rohit builds ReplayChess and writes practical field
                notes for players who want to understand the reason behind a
                move, not merely memorize an answer.
              </p>
              <a
                href={author.socialUrl}
                target="_blank"
                rel="me noopener noreferrer"
                className="mt-5 inline-flex items-center gap-2 font-sans text-sm text-cb-text-secondary underline decoration-cb-border-strong underline-offset-4"
              >
                Follow @anaestheticdev
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </header>

        <section
          className="px-6 py-16 sm:py-24"
          aria-labelledby="author-articles"
        >
          <div className="mx-auto max-w-7xl">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-sans text-[10px] uppercase tracking-[0.25em] text-cb-text-muted">
                  Published work
                </p>
                <h2 id="author-articles" className="mt-2 font-serif text-4xl">
                  Articles by Rohit
                </h2>
              </div>
              <Link
                href="/about"
                className="font-sans text-sm underline decoration-cb-border-strong underline-offset-4"
              >
                About ReplayChess
              </Link>
            </div>
            <div className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <BlogCard key={post.slug} post={post} />
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
