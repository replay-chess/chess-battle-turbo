import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { BlogCard } from "@/app/blog/_components/BlogCard";
import { CategoryNav } from "@/app/blog/_components/CategoryNav";
import { BLOG_CATEGORIES } from "@/lib/blog-types";
import { getPostsByCategory, isBlogCategory } from "@/lib/blog";
import { createMetadata } from "@/lib/seo";

interface Props {
  params: Promise<{ category: string }>;
}

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(BLOG_CATEGORIES).map((category) => ({ category }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params;
  if (!isBlogCategory(category))
    return {
      title: "Category Not Found",
      robots: { index: false, follow: false },
    };
  const posts = await getPostsByCategory(category);
  const definition = BLOG_CATEGORIES[category];
  return createMetadata({
    title: `${definition.label} Articles`,
    description: definition.description,
    path: `/blog/category/${category}`,
    noIndex: posts.length < 2,
    noFollow: false,
  });
}

export default async function BlogCategoryPage({ params }: Props) {
  const { category } = await params;
  if (!isBlogCategory(category)) notFound();
  const posts = await getPostsByCategory(category);
  const definition = BLOG_CATEGORIES[category];

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar breadcrumbLabel={definition.label} />
      <main className="px-6 pb-24 pt-32 sm:pt-40">
        <header className="mx-auto max-w-3xl text-center">
          <p className="font-sans text-[10px] uppercase tracking-[0.3em] text-cb-text-muted">
            Journal category
          </p>
          <h1 className="mt-4 font-serif text-5xl text-cb-text sm:text-6xl">
            {definition.label}
          </h1>
          <p className="mx-auto mt-5 max-w-2xl font-sans text-base leading-7 text-cb-text-muted">
            {definition.description}
          </p>
        </header>
        <div className="mx-auto mt-10 max-w-7xl">
          <CategoryNav active={category} />
          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <BlogCard key={post.slug} post={post} />
            ))}
          </div>
          {posts.length === 0 && (
            <p className="mt-12 border border-cb-border p-8 text-center font-sans text-sm text-cb-text-muted">
              The first article in this category is being prepared.
            </p>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
