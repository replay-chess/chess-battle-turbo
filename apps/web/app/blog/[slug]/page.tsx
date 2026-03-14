import { notFound } from "next/navigation";
import Link from "next/link";
import { getBlogPostBySlug, blogPosts } from "@/lib/blog-data";
import { safeJsonLd } from "@/lib/seo";
import { Navbar } from "../../components/Navbar";
import { Footer } from "../../components/Footer";


interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return blogPosts.map((post) => ({ slug: post.slug }));
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getBlogPostBySlug(slug);

  if (!post) {
    notFound();
  }

  const blogPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: new Date(post.date).toISOString(),
    author: {
      "@type": "Organization",
      name: "ReplayChess",
    },
    publisher: {
      "@type": "Organization",
      name: "ReplayChess",
      logo: {
        "@type": "ImageObject",
        url: "https://www.playchess.tech/chess-logo-bnw.png",
      },
    },
    url: `https://www.playchess.tech/blog/${slug}`,
    image: `https://www.playchess.tech/og?title=${encodeURIComponent(post.title)}&type=blog`,
  };

  // Parse markdown-like content into sections
  const sections = post.content.split(/\n## /).map((section, i) => {
    if (i === 0) return { heading: null, body: section.trim() };
    const newlineIdx = section.indexOf("\n");
    return {
      heading: newlineIdx > -1 ? section.slice(0, newlineIdx).trim() : section.trim(),
      body: newlineIdx > -1 ? section.slice(newlineIdx + 1).trim() : "",
    };
  });

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(blogPostingJsonLd) }}
      />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <article className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 sm:pt-36 pb-16">
        {/* Back link */}
        <Link
          href="/blog"
          style={{ fontFamily: "'Geist', sans-serif" }}
          className="inline-flex items-center gap-2 text-xs text-cb-text-muted hover:text-cb-text-secondary transition-colors uppercase tracking-widest mb-8"
        >
          ← All Articles
        </Link>

        {/* Header */}
        <header className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] px-2 py-0.5 border border-cb-border text-cb-text-secondary uppercase tracking-wider"
            >
              {post.category}
            </span>
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-[10px] text-cb-text-faint"
            >
              {post.readTime}
            </span>
          </div>
          <h1
            style={{ fontFamily: "'Instrument Serif', serif" }}
            className="text-4xl sm:text-5xl text-cb-text mb-4 leading-tight"
          >
            {post.title}
          </h1>
          <p
            style={{ fontFamily: "'Geist', sans-serif" }}
            className="text-base text-cb-text-muted leading-relaxed"
          >
            {post.excerpt}
          </p>
          <div className="flex items-center gap-4 mt-6">
            <span
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-xs text-cb-text-faint"
            >
              {post.date}
            </span>
          </div>
        </header>

        <div className="h-px w-full bg-cb-hover mb-12" />

        {/* Article content */}
        <div className="space-y-8">
          {sections.map((section, i) => (
            <section key={i}>
              {section.heading && (
                <h2
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-2xl text-cb-text mb-4"
                >
                  {section.heading}
                </h2>
              )}
              {section.body.split(/\n### /).map((subsection, j) => {
                if (j === 0) {
                  return subsection.split("\n\n").map((paragraph, k) => (
                    <p
                      key={`${i}-${j}-${k}`}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-cb-text-secondary leading-relaxed mb-4"
                    >
                      {paragraph}
                    </p>
                  ));
                }
                const nlIdx = subsection.indexOf("\n");
                const subHeading = nlIdx > -1 ? subsection.slice(0, nlIdx).trim() : subsection.trim();
                const subBody = nlIdx > -1 ? subsection.slice(nlIdx + 1).trim() : "";
                return (
                  <div key={`${i}-${j}`} className="mb-4">
                    <h3
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-base text-cb-text-secondary font-medium mb-2"
                    >
                      {subHeading}
                    </h3>
                    {subBody.split("\n\n").map((paragraph, k) => (
                      <p
                        key={`${i}-${j}-${k}`}
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-sm text-cb-text-secondary leading-relaxed mb-3"
                      >
                        {paragraph}
                      </p>
                    ))}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </article>

      <Footer />
    </div>
  );
}
