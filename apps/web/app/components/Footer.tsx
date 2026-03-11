"use client";

import { Mail, Twitter, Github, Youtube, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const footerLinks = {
  product: [
    { name: "Play", href: "/play" },
    { name: "Legends", href: "/legends" },
    { name: "Openings", href: "/openings" },
    { name: "Pricing", href: "/pricing" },
  ],
  company: [
    { name: "About Us", href: "/about" },
    { name: "Blog", href: "/blog" },
    { name: "Careers", href: "/careers", badge: "Hiring" },
    { name: "Contact", href: "/contact" },
  ],
  resources: [
    { name: "Help Center", href: "/help" },
    { name: "Community", href: "/community" },
    { name: "API Docs", href: "/docs/api" },
  ],
  legal: [
    { name: "Terms of Service", href: "/terms" },
    { name: "Privacy Policy", href: "/privacy" },
    { name: "Cookie Policy", href: "/cookies" },
  ],
};

const socialLinks = [
  { icon: Twitter, href: "#", label: "Twitter" },
  { icon: Github, href: "#", label: "GitHub" },
  { icon: Youtube, href: "#", label: "YouTube" },
  { icon: Mail, href: "#", label: "Email" },
];

export function Footer() {
  return (
    <footer className="w-full bg-black relative overflow-hidden">
      {/* Top decorative border */}
      <div className="h-px w-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* Subtle grid background */}
      <div
        className="absolute inset-0 opacity-[0.015]"
        style={{
          backgroundImage: `linear-gradient(90deg, white 1px, transparent 1px), linear-gradient(white 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-10 sm:py-16 lg:py-20">
        {/* Main Footer Content */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8">

          {/* Brand Section */}
          <div className="lg:col-span-4 space-y-6">
            <Link href="/" className="flex items-center gap-3 group">
              <div className="w-12 h-12 bg-white flex items-center justify-center group-hover:bg-white/90 transition-colors">
                <span className="text-black text-2xl">♟</span>
              </div>
              <div>
                <span
                  style={{ fontFamily: "'Instrument Serif', serif" }}
                  className="text-xl text-white block"
                >
                  ReplayChess
                </span>
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-[10px] text-white/30 uppercase tracking-widest"
                >
                  Your Go-To Place for Chess Mastery and Fun
                </span>
              </div>
            </Link>

            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-white/40 text-sm leading-relaxed max-w-sm"
            >
              Challenge friends, play legendary positions from chess history,
              and master the game with our immersive battle experience.
            </p>

            {/* Newsletter */}
            <div className="pt-2">
              <p
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs text-white/50 uppercase tracking-widest mb-3"
              >
                Stay Updated
              </p>
              <form className="flex group">
                <input
                  type="email"
                  placeholder="Enter your email"
                  className={cn(
                    "flex-1 bg-white/[0.03] border border-white/10",
                    "px-4 py-3 text-sm text-white",
                    "placeholder:text-white/20",
                    "focus:outline-none focus:border-white/30 focus:bg-white/[0.05]",
                    "transition-all duration-300"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                />
                <button
                  type="submit"
                  className={cn(
                    "group/btn relative overflow-hidden",
                    "px-6 py-3 bg-white text-black",
                    "text-sm font-medium",
                    "transition-all duration-300"
                  )}
                  style={{ fontFamily: "'Geist', sans-serif" }}
                >
                  <span className="absolute inset-0 bg-black origin-left scale-x-0 group-hover/btn:scale-x-100 transition-transform duration-300" />
                  <span className="relative group-hover/btn:text-white transition-colors duration-300">
                    Subscribe
                  </span>
                </button>
              </form>
            </div>

            {/* Social Links */}
            <div className="flex items-center gap-2 pt-4">
              {socialLinks.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  aria-label={social.label}
                  className={cn(
                    "w-10 h-10 border border-white/10",
                    "flex items-center justify-center",
                    "hover:border-white/30 hover:bg-white hover:text-black",
                    "text-white/40 transition-all duration-300"
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
                className="text-xs font-medium uppercase tracking-[0.2em] text-white/60"
              >
                Product
              </h3>
              <ul className="space-y-3">
                {footerLinks.product.map((item) => (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="group inline-flex items-center gap-1 text-sm text-white/40 hover:text-white transition-colors"
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
                className="text-xs font-medium uppercase tracking-[0.2em] text-white/60"
              >
                Company
              </h3>
              <ul className="space-y-3">
                {footerLinks.company.map((item) => (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="group inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors"
                    >
                      {item.name}
                      {item.badge && (
                        <span className="relative inline-flex items-center gap-1.5 text-[9px] px-2 py-0.5 border border-white/20 text-white/60 font-medium uppercase tracking-wider group-hover:border-white/40 group-hover:text-white/80 transition-all">
                          <span className="w-1 h-1 bg-emerald-400 rounded-full animate-pulse" />
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Resources */}
            <div className="space-y-4">
              <h3
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs font-medium uppercase tracking-[0.2em] text-white/60"
              >
                Resources
              </h3>
              <ul className="space-y-3">
                {footerLinks.resources.map((item) => (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="group inline-flex items-center gap-1 text-sm text-white/40 hover:text-white transition-colors"
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
                className="text-xs font-medium uppercase tracking-[0.2em] text-white/60"
              >
                Legal
              </h3>
              <ul className="space-y-3">
                {footerLinks.legal.map((item) => (
                  <li key={item.name}>
                    <Link
                      href={item.href}
                      style={{ fontFamily: "'Geist', sans-serif" }}
                      className="text-sm text-white/40 hover:text-white transition-colors"
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
        <div className="mt-10 sm:mt-16 pt-6 sm:pt-8 border-t border-white/[0.08]">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <p
              style={{ fontFamily: "'Geist', sans-serif" }}
              className="text-xs text-white/30 tracking-wide"
            >
              © {new Date().getFullYear()} ReplayChess. All rights reserved.
            </p>

            <div className="flex items-center gap-6">
              <span
                style={{ fontFamily: "'Geist', sans-serif" }}
                className="text-xs text-white/20"
              >
                Made with precision
              </span>
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span
                  style={{ fontFamily: "'Geist', sans-serif" }}
                  className="text-xs text-white/30"
                >
                  All systems operational
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
