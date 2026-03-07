"use client";

import { useState, useEffect } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

interface Section {
  id: string;
  title: string;
  content: React.ReactNode;
}

interface LegalPageLayoutProps {
  title: string;
  lastUpdated: string;
  sections: Section[];
}

export function LegalPageLayout({ title, lastUpdated, sections }: LegalPageLayoutProps) {
  const [activeSection, setActiveSection] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px" }
    );

    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sections]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <Navbar />

      {/* Grid background */}
      <div
        className="fixed inset-0 opacity-[0.015] pointer-events-none"
        style={{
          backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
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
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="h-px w-12 bg-white/20" />
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-white/40 text-[10px] tracking-[0.4em] uppercase"
              >
                Legal
              </span>
              <div className="h-px w-12 bg-white/20" />
            </div>
            <h1
              style={{ fontFamily: "'Instrument Serif', serif" }}
              className="text-5xl sm:text-6xl md:text-7xl text-white mb-4"
            >
              {title}
            </h1>
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-sm text-white/30"
            >
              Last updated: {lastUpdated}
            </p>
          </motion.div>
        </div>
      </section>

      <div className="h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* Mobile TOC */}
      <div className="lg:hidden sticky top-[57px] md:top-[89px] z-40 bg-black/80 backdrop-blur-xl border-b border-white/[0.08]">
        <div className="overflow-x-auto scrollbar-hide">
          <div className="flex gap-2 px-6 py-3 min-w-max">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => scrollTo(section.id)}
                style={{ fontFamily: "'Geist', sans-serif" }}
                className={cn(
                  "px-3 py-1.5 text-xs whitespace-nowrap transition-all duration-300",
                  activeSection === section.id
                    ? "bg-white text-black"
                    : "border border-white/10 text-white/40 hover:text-white hover:border-white/30"
                )}
              >
                {section.title}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <section className="relative py-12 sm:py-16 px-6">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Desktop TOC */}
          <aside className="hidden lg:block lg:col-span-3">
            <div className="sticky top-36">
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs text-white/30 uppercase tracking-[0.2em] mb-4"
              >
                Contents
              </p>
              <nav className="space-y-1">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => scrollTo(section.id)}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                    className={cn(
                      "block w-full text-left px-3 py-2 text-sm transition-all duration-300",
                      activeSection === section.id
                        ? "text-white bg-white/[0.05] border-l-2 border-white"
                        : "text-white/30 hover:text-white/60 border-l-2 border-transparent"
                    )}
                  >
                    {section.title}
                  </button>
                ))}
              </nav>
            </div>
          </aside>

          {/* Document Body */}
          <div className="lg:col-span-9 max-w-3xl">
            {sections.map((section, index) => (
              <motion.div
                key={section.id}
                id={section.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.05 }}
                className="mb-12 scroll-mt-28"
              >
                <h2
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-2xl sm:text-3xl text-white mb-6"
                >
                  {section.title}
                </h2>
                <div
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-sm text-white/40 leading-relaxed space-y-4"
                >
                  {section.content}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
