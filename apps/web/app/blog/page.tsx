import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { BlogCard } from "@/app/blog/_components/BlogCard";
import { CategoryNav } from "@/app/blog/_components/CategoryNav";
import { getBlogPosts, getFeaturedBlogPost } from "@/lib/blog";

export default async function BlogPage() {
  const [posts, featured] = await Promise.all([
    getBlogPosts(),
    getFeaturedBlogPost(),
  ]);
  const articles = featured
    ? posts.filter((post) => post.slug !== featured.slug)
    : posts;

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar breadcrumbLabel="Blog" />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.015]"
        style={{
          backgroundImage:
            "linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <main className="relative">
        <header className="px-6 pb-12 pt-32 text-center sm:pb-16 sm:pt-40">
          <div className="mx-auto max-w-3xl">
            <div className="mb-6 flex items-center justify-center gap-4">
              <div className="h-px w-12 bg-cb-border-strong" />
              <span className="font-sans text-[10px] uppercase tracking-[0.4em] text-cb-text-muted">
                Ideas worth replaying
              </span>
              <div className="h-px w-12 bg-cb-border-strong" />
            </div>
            <h1 className="font-serif text-5xl text-cb-text sm:text-6xl md:text-7xl">
              Chess strategy, openings and famous games
            </h1>
            <p className="mx-auto mt-5 max-w-2xl font-sans text-base leading-7 text-cb-text-muted sm:text-lg">
              Practical chess lessons, opening ideas, and famous games explained
              for players who want to understand more than the next move.
            </p>
          </div>
        </header>

        <section className="px-6 pb-12" aria-label="Browse by category">
          <CategoryNav />
        </section>

        <div className="h-px w-full bg-gradient-to-r from-transparent via-cb-border to-transparent" />

        {featured && (
          <section
            className="px-6 py-12 sm:py-16"
            aria-labelledby="featured-article"
          >
            <div className="mx-auto max-w-7xl">
              <h2 id="featured-article" className="sr-only">
                Featured article
              </h2>
              <BlogCard post={featured} featured />
            </div>
          </section>
        )}

        <section
          className="px-6 pb-20 pt-8 sm:pb-24"
          aria-labelledby="latest-articles"
        >
          <div className="mx-auto max-w-7xl">
            <div className="mb-7 flex items-end justify-between gap-4">
              <div>
                <p className="font-sans text-[10px] uppercase tracking-[0.2em] text-cb-text-muted">
                  From the journal
                </p>
                <h2
                  id="latest-articles"
                  className="mt-2 font-serif text-3xl text-cb-text sm:text-4xl"
                >
                  Latest articles
                </h2>
              </div>
              <a
                href="/blog/rss.xml"
                className="font-sans text-xs text-cb-text-muted underline decoration-cb-border-strong underline-offset-4 hover:text-cb-text"
              >
                RSS feed
              </a>
            </div>
            {articles.length > 0 ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {articles.map((post) => (
                  <BlogCard key={post.slug} post={post} />
                ))}
              </div>
            ) : (
              <p className="border border-cb-border p-8 font-sans text-sm text-cb-text-muted">
                More field notes are being prepared.
              </p>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
