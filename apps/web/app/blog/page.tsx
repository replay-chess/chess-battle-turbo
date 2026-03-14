"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { blogPosts, featuredPost } from "@/lib/blog-data";

const categories = ["All", "Strategy", "Updates", "Legends", "Community"];

const articles = blogPosts.filter((p) => !p.featured);

const gradients = [
  "from-cb-surface-elevated to-cb-hover",
  "from-cb-hover to-cb-hover",
  "from-cb-hover to-cb-surface-elevated",
  "from-cb-hover to-cb-hover",
  "from-cb-surface-elevated to-cb-hover",
  "from-cb-hover to-cb-hover",
];

export default function BlogPage() {
  const [activeCategory, setActiveCategory] = useState("All");

  const filteredArticles =
    activeCategory === "All"
      ? articles
      : articles.filter((a) => a.category === activeCategory);

  const showFeatured = activeCategory === "All" || activeCategory === featuredPost.category;

  return (
    <div className="min-h-screen bg-cb-bg text-cb-text">
      <Navbar />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      {/* Hero */}
      <section className="relative pt-32 pb-12 sm:pt-40 sm:pb-16 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center"
          >
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="h-px w-12 bg-cb-border-strong" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-cb-text-muted text-[10px] tracking-[0.4em] uppercase"
              >
                Insights & Stories
              </span>
              <div className="h-px w-12 bg-cb-border-strong" />
            </div>
            <h1
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-5xl sm:text-6xl md:text-7xl text-cb-text mb-4"
            >
              The ReplayChess Journal
            </h1>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-lg text-cb-text-muted max-w-xl mx-auto"
            >
              Strategy, stories, and updates from the world of ReplayChess.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Category Chips */}
      <section className="relative px-6 pb-12">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 flex-wrap">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              style={{ fontFamily: "'Geist', sans-serif" }}
              className={cn(
                "px-4 py-2 text-xs uppercase tracking-widest transition-all duration-300",
                activeCategory === category
                  ? "bg-cb-accent text-cb-accent-fg"
                  : "border border-cb-border text-cb-text-muted hover:text-cb-text hover:border-cb-border-strong"
              )}
            >
              {category}
            </button>
          ))}
        </div>
      </section>

      <div className="h-px w-full bg-gradient-to-r from-transparent via-cb-border to-transparent" />

      {/* Featured Post */}
      {showFeatured && (
        <section className="relative py-12 sm:py-16 px-6">
          <div className="max-w-7xl mx-auto">
            <Link href={`/blog/${featuredPost.slug}`}>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="group relative border border-cb-border overflow-hidden hover:border-cb-border-strong transition-colors cursor-pointer"
              >
                <div className="aspect-[21/9] bg-gradient-to-br from-cb-hover via-transparent to-cb-hover relative">
                  {/* Decorative chess notation */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-[120px] sm:text-[200px] text-cb-text-faint select-none"
                    >
                      1.e4 e5
                    </span>
                  </div>

                  {/* Content overlay */}
                  <div className="absolute bottom-0 left-0 right-0 p-6 sm:p-10 bg-gradient-to-t from-cb-gradient-from via-cb-bg to-transparent">
                    <span
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="inline-block text-[10px] px-2 py-0.5 border border-cb-border-strong text-cb-text-secondary uppercase tracking-wider mb-3"
                    >
                      {featuredPost.category}
                    </span>
                    <h2
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-2xl sm:text-4xl text-cb-text mb-3 group-hover:text-cb-text-secondary transition-colors"
                    >
                      {featuredPost.title}
                    </h2>
                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-cb-text-muted max-w-2xl mb-4 hidden sm:block"
                    >
                      {featuredPost.excerpt}
                    </p>
                    <div className="flex items-center gap-4">
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-xs text-cb-text-muted"
                      >
                        {featuredPost.date}
                      </span>
                      <span className="text-cb-text-faint">|</span>
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-xs text-cb-text-muted"
                      >
                        {featuredPost.readTime}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            </Link>
          </div>
        </section>
      )}

      {/* Article Grid */}
      <section className="relative py-12 sm:py-16 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-cb-surface-elevated">
            {filteredArticles.map((article, index) => (
              <Link key={article.slug} href={`/blog/${article.slug}`}>
                <motion.article
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.08 }}
                  className={cn(
                    "group relative bg-cb-bg p-0 cursor-pointer",
                    "hover:bg-cb-accent transition-colors duration-500"
                  )}
                >
                  {/* Gradient placeholder */}
                  <div
                    className={cn(
                      "aspect-[16/9] bg-gradient-to-br",
                      gradients[index % gradients.length],
                      "group-hover:opacity-80 transition-opacity duration-500"
                    )}
                  />

                  <div className="p-6">
                    <div className="flex items-center gap-3 mb-3">
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-[10px] px-2 py-0.5 border border-cb-border group-hover:border-cb-accent-fg/10 text-cb-text-muted group-hover:text-cb-accent-fg/40 uppercase tracking-wider transition-colors duration-500"
                      >
                        {article.category}
                      </span>
                      <span
                        style={{ fontFamily: "'Geist', sans-serif" }}
                        className="text-[10px] text-cb-text-faint group-hover:text-cb-accent-fg/20 transition-colors duration-500"
                      >
                        {article.readTime}
                      </span>
                    </div>

                    <h3
                      style={{ fontFamily: "'Instrument Serif', serif" }}
                      className="text-xl text-cb-text group-hover:text-cb-accent-fg transition-colors duration-500 mb-2"
                    >
                      {article.title}
                    </h3>

                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-cb-text-muted group-hover:text-cb-accent-fg/50 transition-colors duration-500 leading-relaxed mb-4"
                    >
                      {article.excerpt}
                    </p>

                    <p
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-xs text-cb-text-faint group-hover:text-cb-accent-fg/30 transition-colors duration-500"
                    >
                      {article.date}
                    </p>
                  </div>

                  <div className={cn(
                    "absolute top-4 right-4 w-8 h-8",
                    "border-t border-r",
                    "border-cb-border group-hover:border-cb-accent-fg/10",
                    "transition-colors duration-500"
                  )} />
                </motion.article>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Newsletter CTA */}
      <section className="relative py-20 px-6">
        <div className="max-w-xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-3xl sm:text-4xl text-cb-text mb-4"
            >
              Never Miss a Post
            </h2>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-sm mb-6"
            >
              Get the latest articles and updates delivered straight to your inbox.
            </p>
            <form className="flex max-w-md mx-auto">
              <input
                type="email"
                placeholder="Enter your email"
                className={cn(
                  "flex-1 bg-cb-hover border border-cb-border",
                  "px-4 py-3 text-sm text-cb-text",
                  "placeholder:text-cb-text-faint",
                  "focus:outline-none focus:border-cb-border-strong focus:bg-cb-hover",
                  "transition-all duration-300"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              />
              <button
                type="submit"
                className={cn(
                  "group/btn relative overflow-hidden",
                  "px-6 py-3 bg-cb-accent text-cb-accent-fg",
                  "text-sm font-medium",
                  "transition-all duration-300"
                )}
                style={{ fontFamily: "'Geist', sans-serif" }}
              >
                <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover/btn:scale-x-100 transition-transform duration-300" />
                <span className="relative flex items-center gap-2 group-hover/btn:text-cb-text transition-colors duration-300">
                  Subscribe
                  <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </button>
            </form>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
