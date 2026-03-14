"use client";

import React from "react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Home, CreditCard, Receipt, Shield, User } from "lucide-react";
import { usePWAInstall } from "@/lib/hooks";
import { InstallAppPopover } from "./InstallAppPopover";
import { NavbarTournaments } from "./NavbarTournaments";
import { Breadcrumbs } from "./Breadcrumbs";
import { useUserStore } from "@/lib/stores";

export const Navbar = () => {
  const router = useRouter();
  const { canInstall, isInstalled, isIOS, install } = usePWAInstall();

  const user = useUserStore((s) => s.user);
  const subscription = useUserStore((s) => s.subscription);

  const userReferenceId = user?.referenceId ?? null;
  const isAdmin = user?.role === "ADMIN";
  const customerId = subscription?.customerId;

  const handlePlayClick = () => {
    if (useUserStore.getState().user !== null) {
      router.push("/play");
    } else {
      router.push("/sign-in");
    }
  };

  return (
    <>
    <nav
      aria-label="Main navigation"
      className={cn(
        "fixed top-0 left-0 right-0 w-full z-50",
        "flex justify-between items-center",
        "px-4 sm:px-6 lg:px-8 py-3",
        "bg-cb-backdrop backdrop-blur-xl",
        "border-b border-cb-border",
        "supports-[backdrop-filter]:bg-cb-backdrop"
      )}
      style={{
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 group">
        <Image
          src="/chess-logo-bnw.png"
          alt="ReplayChess chess piece logo"
          title="ReplayChess"
          width={100}
          height={100}
          className={cn(
            "w-10 h-10 sm:w-11 sm:h-11",
            "transition-all duration-300",
            "group-hover:opacity-80"
          )}
        />
        <span
          style={{ fontFamily: "'Instrument Serif', serif" }}
          className="hidden sm:block text-cb-text text-lg tracking-tight"
        >
          ReplayChess
        </span>
      </Link>

      {/* Right Side Actions */}
      <div className="flex items-center gap-3">
        {/* Install App Popover - only show if can install and not already installed */}
        {canInstall && !isInstalled && (
          <InstallAppPopover isIOS={isIOS} onInstall={install} />
        )}

        {/* Play Button */}
        <button
          onClick={handlePlayClick}
          className={cn(
            "group relative overflow-hidden",
            "bg-cb-accent text-cb-accent-fg",
            "h-9 px-5",
            "text-sm font-medium tracking-wide",
            "transition-all duration-300"
          )}
          style={{ fontFamily: "'Geist', sans-serif" }}
        >
          {/* Invert animation */}
          <span className="absolute inset-0 bg-cb-bg origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
          <span className="relative flex items-center gap-2 group-hover:text-cb-text transition-colors duration-300">
            <Home className="w-3.5 h-3.5" />
            Home
          </span>
        </button>

        <SignedOut>
          <SignInButton>
            <button
              className={cn(
                "group relative overflow-hidden",
                "h-9 px-4",
                "border border-cb-border-strong hover:border-cb-border-strong",
                "bg-cb-hover",
                "text-sm font-medium tracking-wide",
                "transition-all duration-300",
                "backdrop-blur-sm"
              )}
              style={{ fontFamily: "'Geist', sans-serif" }}
            >
              <span className="absolute inset-0 bg-cb-accent origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-300" />
              <span className="relative text-cb-text-secondary group-hover:text-cb-accent-fg transition-colors duration-300">
                Sign In
              </span>
            </button>
          </SignInButton>
        </SignedOut>

        <SignedIn>
          <NavbarTournaments />
          {isAdmin && (
            <Link
              href="/admin"
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
                <Shield className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Admin</span>
              </span>
            </Link>
          )}
          {userReferenceId && (
            <Link
              href={`/profile/${userReferenceId}`}
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
                <User className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Profile</span>
              </span>
            </Link>
          )}
          <div className="ml-2">
            <UserButton
              appearance={{
                variables: {
                  colorBackground: 'var(--cb-bg)',
                  colorText: 'var(--cb-text)',
                  colorTextSecondary: 'var(--cb-text-secondary)',
                  colorPrimary: 'var(--cb-text)',
                  colorNeutral: 'var(--cb-text-muted)',
                  colorDanger: '#ef4444',
                  borderRadius: '0px',
                  fontFamily: "'Geist', sans-serif",
                },
                elements: {
                  avatarBox: "w-9 h-9 border border-cb-border-strong hover:border-cb-border-strong transition-all duration-300",
                  userButtonTrigger: "focus:shadow-none focus:ring-0",
                  userButtonPopoverCard: {
                    backgroundColor: 'var(--cb-bg)',
                    border: '1px solid var(--cb-border)',
                    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5)',
                    borderRadius: '0px',
                  },
                  userButtonPopoverActionButton: {
                    fontFamily: "'Geist', sans-serif",
                    fontSize: '13px',
                    color: 'var(--cb-text-secondary)',
                    borderRadius: '0px',
                    '&:hover': {
                      backgroundColor: 'var(--cb-hover)',
                      color: 'var(--cb-text)',
                    },
                  },
                  userButtonPopoverActionButtonText: {
                    fontFamily: "'Geist', sans-serif",
                  },
                  userButtonPopoverActionButtonIcon: {
                    color: 'var(--cb-text-secondary)',
                  },
                  userButtonPopoverCustomItemButton: {
                    fontFamily: "'Geist', sans-serif",
                    fontSize: '13px',
                    color: 'var(--cb-text-secondary)',
                    borderRadius: '0px',
                    '&:hover': {
                      backgroundColor: 'var(--cb-hover)',
                      color: 'var(--cb-text)',
                    },
                  },
                  userButtonPopoverCustomItemButtonIconBox: {
                    color: 'var(--cb-text-secondary)',
                  },
                  userButtonPopoverFooter: {
                    display: 'none',
                  },
                  userPreview: {
                    padding: '16px',
                    borderBottom: '1px solid var(--cb-border)',
                  },
                  userPreviewMainIdentifier: {
                    fontFamily: "'Geist', sans-serif",
                    fontWeight: '500',
                    color: 'var(--cb-text)',
                  },
                  userPreviewSecondaryIdentifier: {
                    fontFamily: "'Geist', sans-serif",
                    color: 'var(--cb-text-muted)',
                    fontSize: '12px',
                  },
                },
              }}
            >
              <UserButton.MenuItems>
                <UserButton.Link
                  label="Subscription"
                  labelIcon={<CreditCard className="w-4 h-4" />}
                  href="/pricing"
                />
                {customerId && (
                  <UserButton.Action
                    label="Manage Billing"
                    labelIcon={<Receipt className="w-4 h-4" />}
                    onClick={() => window.open(`/api/customer-portal?customer_id=${customerId}`, '_blank')}
                  />
                )}
              </UserButton.MenuItems>
            </UserButton>
          </div>
        </SignedIn>
      </div>
    </nav>
    <Breadcrumbs />
    </>
  );
};
