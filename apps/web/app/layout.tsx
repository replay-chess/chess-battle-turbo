import type { Metadata } from "next";
import localFont from "next/font/local";
import { Instrument_Serif } from "next/font/google";
import { safeJsonLd } from "@/lib/seo";

import "./globals.css";
import { UserSync } from "./components/UserSync";
import { GoogleAnalytics } from "./components/GoogleAnalytics";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "./components/ThemeProvider";
import { ThemeAwareClerkProvider } from "./components/ThemeAwareClerkProvider";
import { ThemeAwareToaster } from "./components/ThemeAwareToaster";
import { SpeedInsights } from "@vercel/speed-insights/next"

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#171717',
};

export const metadata: Metadata = {
  metadataBase: new URL('https://www.playchess.tech'),
  title: {
    default: "ReplayChess - Master Chess Through Legendary Games",
    template: "%s | ReplayChess",
  },
  description: "Replay iconic chess positions from history's greatest games. Study grandmaster moves, challenge friends, and master the classics.",
  openGraph: {
    title: "ReplayChess - Master Chess Through Legendary Games",
    description: "Replay iconic chess positions from history's greatest games. Study grandmaster moves, challenge friends, and master the classics.",
    url: "https://www.playchess.tech",
    siteName: "ReplayChess",
    images: [{ url: "/og-image.jpg", width: 1200, height: 800, alt: "ReplayChess - Master chess through legendary games" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ReplayChess - Master Chess Through Legendary Games",
    description: "Replay iconic chess positions from history's greatest games. Study grandmaster moves, challenge friends, and master the classics.",
    images: ["/og-image.jpg"],
  },
  alternates: {
    canonical: "https://www.playchess.tech",
  },
  robots: {
    index: true,
    follow: true,
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ReplayChess",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icons/icon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/icons/icon-192x192.png",
    apple: "/icons/icon-384x384.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Fonts loaded via next/font/google (self-hosted at build time) — no preconnect needed */}
        <link rel="dns-prefetch" href="https://img.clerk.com" />
        <link rel="preconnect" href="https://www.googletagmanager.com" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLd({
              "@context": "https://schema.org",
              "@type": "Organization",
              name: "ReplayChess",
              url: "https://www.playchess.tech",
              logo: "https://www.playchess.tech/chess-logo-bnw.png",
            }),
          }}
        />
        {process.env.NODE_ENV === "development" && (
          <>
            <script
              src="https://unpkg.com/react-scan/dist/auto.global.js"
              crossOrigin="anonymous"
            />
            <script
              src="https://unpkg.com/react-grab/dist/index.global.js"
              crossOrigin="anonymous"
            />
          </>
        )}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} bg-cb-bg`}
      >
        <ThemeProvider>
          <ThemeAwareClerkProvider>
            <GoogleAnalytics />
            <Analytics />
            <SpeedInsights />
            <UserSync />
            <ThemeAwareToaster />
            {children}
          </ThemeAwareClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}