"use client";

import { Mail, Twitter, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

const footerLinks = {
  product: [
    { name: "Try Free", href: "/try" },
    { name: "Chess Legends", href: "/learn/legends" },
    { name: "Opening Guide", href: "/learn/openings" },
    { name: "Pricing", href: "/pricing" },
  ],
  company: [
    { name: "About Us", href: "/about" },
    { name: "Blog", href: "/blog" },
    { name: "Careers", href: "/careers" },
    { name: "Contact", href: "/contact" },
  ],
  resources: [
    { name: "Help Center", href: "/help" },
    { name: "Community", href: "/community" },
    { name: "Editorial Policy", href: "/blog/editorial-policy" },
    { name: "API Docs", href: "/docs/api" },
  ],
  legal: [
    { name: "Terms of Service", href: "/terms" },
    { name: "Privacy Policy", href: "/privacy" },
    { name: "Cookie Policy", href: "/cookies" },
  ],
};

const socialLinks = [
  {
    icon: Twitter,
    href: "https://x.com/anaestheticdev",
    label: "Rohit Pandit on X",
  },
  {
    icon: Mail,
    href: "mailto:hello@playchess.tech",
    label: "Email ReplayChess",
  },
];

export function Footer() {
  return (
    <footer className="w-full bg-cb-bg relative overflow-hidden">
      {/* Top decorative border */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-cb-border-strong to-transparent" />

      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-10 sm:py-16 lg:py-20">
        {/* Main Footer Content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8">
          {/* Brand Section */}
          <div className="lg:col-span-4 space-y-6">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-12 h-12 bg-cb-surface border border-cb-border-strong flex items-center justify-center group-hover:bg-cb-hover transition-colors">
                <span className="text-cb-text text-2xl">♟</span>
              </div>
              <div>
                <span
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-xl text-cb-text block"
                >
                  ReplayChess
                </span>
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] text-cb-text-muted uppercase tracking-widest"
                >
                  Your Go-To Place for Chess Mastery and Fun
                </span>
              </div>
            </Link>

            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-cb-text-muted text-sm leading-relaxed max-w-sm"
            >
              Challenge friends, play legendary positions from chess history,
              and master the game with our immersive battle experience.
            </p>

            {/* Social Links */}
            <div className="flex items-center gap-2 pt-4">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  rel={
                    social.href.startsWith("https://")
                      ? "me noopener noreferrer"
                      : undefined
                  }
                  target={
                    social.href.startsWith("https://") ? "_blank" : undefined
                  }
                  aria-label={social.label}
                  className={cn(
                    "w-10 h-10 border border-cb-border",
                    "flex items-center justify-center",
                    "hover:border-cb-border-strong hover:bg-cb-accent hover:text-cb-accent-fg",
                    "text-cb-text-muted transition-all duration-300",
                  )}
                >
                  <social.icon className="w-4 h-4" strokeWidth={1.5} />
                </a>
              ))}
            </div>
          </div>

          {/* Links Grid */}
          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-8">
            {/* Product */}
            <div className="space-y-4">
              <h3
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary"
              >
                Product
              </h3>
              <ul className="space-y-3">
                {footerLinks.product.map((item) => (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="group inline-flex items-center gap-1 text-sm text-cb-text-muted hover:text-cb-text transition-colors"
                    >
                      {item.name}
                      <ArrowUpRight className="w-3 h-3 opacity-0 -translate-y-0.5 translate-x-0.5 group-hover:opacity-100 group-hover:translate-y-0 group-hover:translate-x-0 transition-all" />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company */}
            <div className="space-y-4">
              <h3
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary"
              >
                Company
              </h3>
              <ul className="space-y-3">
                {footerLinks.company.map((item) => (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="group inline-flex items-center gap-2 text-sm text-cb-text-muted hover:text-cb-text transition-colors"
                    >
                      {item.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Resources */}
            <div className="space-y-4">
              <h3
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary"
              >
                Resources
              </h3>
              <ul className="space-y-3">
                {footerLinks.resources.map((item) => (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="group inline-flex items-center gap-1 text-sm text-cb-text-muted hover:text-cb-text transition-colors"
                    >
                      {item.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal */}
            <div className="space-y-4">
              <h3
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs font-medium uppercase tracking-[0.2em] text-cb-text-secondary"
              >
                Legal
              </h3>
              <ul className="space-y-3">
                {footerLinks.legal.map((item) => (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-cb-text-muted hover:text-cb-text transition-colors"
                    >
                      {item.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-10 sm:mt-16 pt-6 sm:pt-8 border-t border-cb-border">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-xs text-cb-text-muted tracking-wide"
            >
              © {new Date().getFullYear()} ReplayChess. All rights reserved.
            </p>

            <div className="flex items-center gap-6">
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs text-cb-text-faint"
              >
                Built in public
              </span>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs text-cb-text-muted"
                >
                  ReplayChess is evolving
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
