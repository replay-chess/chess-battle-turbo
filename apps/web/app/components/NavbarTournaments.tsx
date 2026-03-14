"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Trophy } from "lucide-react";

export function NavbarTournaments() {

  return (
    <Link
      href="/tournaments"
      className={cn(
        "group relative overflow-hidden",
        "bg-cb-accent text-cb-accent-fg",
        "h-9 px-3 sm:px-5",
        "text-sm font-medium tracking-wide",
        "transition-all duration-300",
        "flex items-center"
      )}
      style={{ fontFamily: "'Geist', sans-serif" }}
    >
      <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
      <span className="relative flex items-center gap-1.5 text-cb-accent-fg group-hover:text-cb-text transition-colors duration-300">
        <Trophy className="w-3.5 h-3.5" strokeWidth={1.5} />
        <span className="hidden sm:inline">Tournaments</span>
      </span>
    </Link>
  );
}
