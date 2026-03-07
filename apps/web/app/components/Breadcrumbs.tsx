"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { cn } from "../../lib/utils";
import { safeJsonLd } from "../../lib/seo";
import {
  Home, Gamepad2, Clock, Swords, Users, Shield, BookOpen, Crown, Grid3X3,
  Trophy, BarChart3, User, HelpCircle, Mail, Heart, FileText, Cookie, Code, Info, Plus,
} from "lucide-react";

interface BreadcrumbItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
}

// Routes where breadcrumbs should be hidden
const hiddenRoutes = ["/", "/sign-in", "/onboarding", "/about", "/careers", "/pricing"];

// Icons for breadcrumb items
const icons = {
  home: <Home className="w-3 h-3" />,
  play: <Gamepad2 className="w-3 h-3" />,
  queue: <Clock className="w-3 h-3" />,
  game: <Swords className="w-3 h-3" />,
  join: <Users className="w-3 h-3" />,
  admin: <Shield className="w-3 h-3" />,
  legends: <Crown className="w-3 h-3" />,
  openings: <Grid3X3 className="w-3 h-3" />,
  blog: <BookOpen className="w-3 h-3" />,
  tournament: <Trophy className="w-3 h-3" />,
  analysis: <BarChart3 className="w-3 h-3" />,
  profile: <User className="w-3 h-3" />,
  help: <HelpCircle className="w-3 h-3" />,
  contact: <Mail className="w-3 h-3" />,
  community: <Heart className="w-3 h-3" />,
  docs: <Code className="w-3 h-3" />,
  terms: <FileText className="w-3 h-3" />,
  privacy: <FileText className="w-3 h-3" />,
  cookies: <Cookie className="w-3 h-3" />,
  positions: <Grid3X3 className="w-3 h-3" />,
  create: <Plus className="w-3 h-3" />,
  info: <Info className="w-3 h-3" />,
};

function getBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const breadcrumbs: BreadcrumbItem[] = [
    { label: "Home", href: "/", icon: icons.home },
  ];

  // Play
  if (pathname === "/play" || pathname.startsWith("/play?")) {
    breadcrumbs.push({ label: "Play", href: "/play", icon: icons.play });
  }

  // Queue
  if (pathname.startsWith("/queue")) {
    breadcrumbs.push({ label: "Play", href: "/play", icon: icons.play });
    breadcrumbs.push({ label: "Queue", href: "/queue", icon: icons.queue });
  }

  // Analysis
  if (pathname.startsWith("/analysis/")) {
    breadcrumbs.push({ label: "Play", href: "/play", icon: icons.play });
    breadcrumbs.push({ label: "Analysis", href: pathname, icon: icons.analysis });
  }

  // Join game
  if (pathname.startsWith("/join/")) {
    breadcrumbs.push({ label: "Join Game", href: pathname, icon: icons.join });
  }

  // Tournaments (public)
  if (pathname === "/tournaments") {
    breadcrumbs.push({ label: "Tournaments", href: "/tournaments", icon: icons.tournament });
  }

  // Tournament detail
  if (pathname.startsWith("/tournament/")) {
    breadcrumbs.push({ label: "Tournaments", href: "/tournaments", icon: icons.tournament });
    breadcrumbs.push({ label: "Tournament", href: pathname, icon: icons.tournament });
  }

  // Join tournament
  if (pathname.startsWith("/join-tournament/")) {
    breadcrumbs.push({ label: "Tournaments", href: "/tournaments", icon: icons.tournament });
    breadcrumbs.push({ label: "Join", href: pathname, icon: icons.join });
  }

  // Admin routes
  if (pathname === "/admin") {
    breadcrumbs.push({ label: "Admin", href: "/admin", icon: icons.admin });
  } else if (pathname === "/admin/legends") {
    breadcrumbs.push({ label: "Admin", href: "/admin", icon: icons.admin });
    breadcrumbs.push({ label: "Legends", href: "/admin/legends", icon: icons.legends });
  } else if (pathname === "/admin/chess-positions") {
    breadcrumbs.push({ label: "Admin", href: "/admin", icon: icons.admin });
    breadcrumbs.push({ label: "Positions", href: "/admin/chess-positions", icon: icons.positions });
  } else if (pathname === "/admin/tournaments") {
    breadcrumbs.push({ label: "Admin", href: "/admin", icon: icons.admin });
    breadcrumbs.push({ label: "Tournaments", href: "/admin/tournaments", icon: icons.tournament });
  } else if (pathname === "/admin/tournaments/create") {
    breadcrumbs.push({ label: "Admin", href: "/admin", icon: icons.admin });
    breadcrumbs.push({ label: "Tournaments", href: "/admin/tournaments", icon: icons.tournament });
    breadcrumbs.push({ label: "Create", href: "/admin/tournaments/create", icon: icons.create });
  }

  // Legends (public)
  if (pathname === "/legends") {
    breadcrumbs.push({ label: "Legends", href: "/legends", icon: icons.legends });
  } else if (pathname.startsWith("/legends/") && !pathname.startsWith("/legends/admin")) {
    breadcrumbs.push({ label: "Legends", href: "/legends", icon: icons.legends });
    breadcrumbs.push({ label: "Legend", href: pathname, icon: icons.legends });
  }

  // Openings
  if (pathname === "/openings") {
    breadcrumbs.push({ label: "Openings", href: "/openings", icon: icons.openings });
  } else if (pathname.startsWith("/openings/")) {
    breadcrumbs.push({ label: "Openings", href: "/openings", icon: icons.openings });
    breadcrumbs.push({ label: "Opening", href: pathname, icon: icons.openings });
  }

  // Blog
  if (pathname === "/blog") {
    breadcrumbs.push({ label: "Blog", href: "/blog", icon: icons.blog });
  } else if (pathname.startsWith("/blog/")) {
    breadcrumbs.push({ label: "Blog", href: "/blog", icon: icons.blog });
    breadcrumbs.push({ label: "Article", href: pathname, icon: icons.blog });
  }

  // Profile
  if (pathname.startsWith("/profile/")) {
    breadcrumbs.push({ label: "Profile", href: pathname, icon: icons.profile });
  }

  // Help / Contact / Community
  if (pathname === "/help") {
    breadcrumbs.push({ label: "Help", href: "/help", icon: icons.help });
  }
  if (pathname === "/contact") {
    breadcrumbs.push({ label: "Contact", href: "/contact", icon: icons.contact });
  }
  if (pathname === "/community") {
    breadcrumbs.push({ label: "Community", href: "/community", icon: icons.community });
  }

  // Docs
  if (pathname === "/docs/api") {
    breadcrumbs.push({ label: "Docs", href: "/docs/api", icon: icons.docs });
    breadcrumbs.push({ label: "API", href: "/docs/api", icon: icons.docs });
  }

  // Legal pages
  if (pathname === "/terms") {
    breadcrumbs.push({ label: "Terms", href: "/terms", icon: icons.terms });
  }
  if (pathname === "/privacy") {
    breadcrumbs.push({ label: "Privacy", href: "/privacy", icon: icons.privacy });
  }
  if (pathname === "/cookies") {
    breadcrumbs.push({ label: "Cookies", href: "/cookies", icon: icons.cookies });
  }

  return breadcrumbs;
}

export const Breadcrumbs = () => {
  const pathname = usePathname();

  // Hide breadcrumbs on specific routes
  if (hiddenRoutes.some((route) => pathname === route || pathname.startsWith("/sign-in"))) {
    return null;
  }

  const breadcrumbs = getBreadcrumbs(pathname);

  // Don't show if only home breadcrumb
  if (breadcrumbs.length <= 1) {
    return null;
  }

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.label,
      item: `https://playchess.tech${crumb.href}`,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbJsonLd) }}
      />
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className={cn(
          "fixed top-[68px] left-0 right-0 z-40",
          "hidden md:flex items-center",
          "px-4 sm:px-6 lg:px-8 py-2",
          "bg-black backdrop-blur-md",
          "border-b border-white/[0.05]"
        )}
        style={{
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        <nav className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1;

            return (
              <React.Fragment key={crumb.href + index}>
                {index > 0 && (
                  <span
                    className="text-white/70 text-[10px] mx-1 select-none flex-shrink-0"
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    /
                  </span>
                )}
                {isLast ? (
                  <span
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap flex-shrink-0",
                      "text-[10px] sm:text-[11px] uppercase tracking-[0.12em]",
                      "text-white"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    {crumb.icon}
                    {crumb.label}
                  </span>
                ) : (
                  <Link
                    href={crumb.href}
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap flex-shrink-0",
                      "text-[10px] sm:text-[11px] uppercase tracking-[0.12em]",
                      "text-white hover:text-white",
                      "transition-colors duration-200"
                    )}
                    style={{ fontFamily: "'Geist', sans-serif" }}
                  >
                    {crumb.icon}
                    {crumb.label}
                  </Link>
                )}
              </React.Fragment>
            );
          })}
        </nav>
      </motion.div>
    </>
  );
};
