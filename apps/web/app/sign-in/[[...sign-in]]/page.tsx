"use client";

import { SignIn } from '@clerk/nextjs';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { getClerkSignInAppearance } from "@/lib/clerk-theme";
import { useTheme } from "next-themes";

export default function Page() {
    const searchParams = useSearchParams();
    const redirectUrl = searchParams.get('redirect_url') || '/';
    const { resolvedTheme } = useTheme();

    return (
        <div className="flex items-center justify-center min-h-screen bg-cb-bg relative overflow-hidden">
            {/* Subtle grid background */}
            <div
                className="absolute inset-0 opacity-[0.015]"
                style={{
                    backgroundImage: `linear-gradient(90deg, var(--cb-grid-line) 1px, transparent 1px), linear-gradient(var(--cb-grid-line) 1px, transparent 1px)`,
                    backgroundSize: '60px 60px',
                }}
            />

            {/* Gradient overlays for depth */}
            <div className="absolute inset-0 bg-gradient-to-b from-cb-gradient-from via-transparent to-cb-bg opacity-50" />
            <div className="absolute inset-0 bg-gradient-to-r from-cb-backdrop via-transparent to-cb-backdrop" />

            {/* Decorative corner elements */}
            <div className="absolute top-8 left-8 w-24 h-24 border-l border-t border-cb-border" />
            <div className="absolute top-8 right-8 w-24 h-24 border-r border-t border-cb-border" />
            <div className="absolute bottom-8 left-8 w-24 h-24 border-l border-b border-cb-border" />
            <div className="absolute bottom-8 right-8 w-24 h-24 border-r border-b border-cb-border" />

            {/* Content container */}
            <div className="relative z-10 flex flex-col items-center">
                {/* Logo/Brand */}
                <Link href="/" className="mb-12 group">
                    <div className="flex flex-col items-center">
                        <div className="w-16 h-16 border border-cb-border-strong flex items-center justify-center mb-4 group-hover:border-cb-text-muted group-hover:bg-cb-hover transition-all duration-300">
                            <span className="text-cb-text text-3xl">&#9812;</span>
                        </div>
                        <h1
                            style={{ fontFamily: "'Instrument Serif', serif" }}
                            className="text-3xl text-cb-text tracking-tight"
                        >
                            ReplayChess
                        </h1>
                        <div className="flex items-center gap-3 mt-2">
                            <div className="h-px w-8 bg-cb-border-strong" />
                            <span
                                style={{ fontFamily: "'Geist', sans-serif" }}
                                className="text-cb-text-muted text-[9px] tracking-[0.3em] uppercase"
                            >
                                Welcome Back
                            </span>
                            <div className="h-px w-8 bg-cb-border-strong" />
                        </div>
                    </div>
                </Link>

                {/* Clerk SignIn with custom appearance */}
                <SignIn
                    fallbackRedirectUrl={redirectUrl}
                    appearance={getClerkSignInAppearance(resolvedTheme)}
                />

                {/* Bottom decorative text */}
                <div className="mt-12 text-center">
                    <div className="flex items-center justify-center gap-4">
                        <div className="h-px w-12 bg-cb-border" />
                        <span
                            style={{ fontFamily: "'Geist', sans-serif" }}
                            className="text-cb-text-faint text-[9px] tracking-[0.3em] uppercase"
                        >
                            Secure Authentication
                        </span>
                        <div className="h-px w-12 bg-cb-border" />
                    </div>
                </div>
            </div>
        </div>
    );
}
