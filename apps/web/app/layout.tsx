import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import { BASE_URL, safeJsonLd } from "@/lib/seo";

import "./globals.css";
import { UserSync } from "./components/UserSync";
import { PostHogIdentify } from "./components/PostHogIdentify";
import { GoogleAnalytics } from "./components/GoogleAnalytics";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "./components/ThemeProvider";
import { ThemeAwareClerkProvider } from "./components/ThemeAwareClerkProvider";
import { ThemeAwareToaster } from "./components/ThemeAwareToaster";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ThemeColorSync } from "./components/ThemeColorSync";
import { TooltipProvider } from "@/components/ui/tooltip";

// next/font/google names the families literally 'Geist' and 'Geist Mono', so the
// existing inline fontFamily: "'Geist'" styles resolve (SPEC D8). app/fonts/*.woff
// stay for global-error.tsx.
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
  display: "swap",
});

// One theme colour; ThemeColorSync follows the app theme (H3). Never set
// maximumScale/userScalable or interactiveWidget (pinch-zoom must keep working).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#FAF9F6",
};

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "ReplayChess - Master Chess Through Legendary Games",
    template: "%s | ReplayChess",
  },
  description:
    "Replay iconic positions from famous chess games, test your calculation against the engine, and learn the strategic ideas behind memorable grandmaster moves.",
  openGraph: {
    title: "ReplayChess - Master Chess Through Legendary Games",
    description:
      "Replay iconic positions from famous chess games, test your calculation against the engine, and learn the strategic ideas behind memorable grandmaster moves.",
    url: BASE_URL,
    siteName: "ReplayChess",
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "ReplayChess - Master chess through legendary games",
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ReplayChess - Master Chess Through Legendary Games",
    description:
      "Replay iconic positions from famous chess games, test your calculation against the engine, and learn the strategic ideas behind memorable grandmaster moves.",
    images: ["/og-image.jpg"],
  },
  alternates: {
    canonical: BASE_URL,
  },
  robots: {
    index: true,
    follow: true,
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
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
  other: {
    // Directory ownership verification (directree.io claim)
    "directree-verify": "directree-verify=5514e531baeb842302968314b8bee9cd",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`light ${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
      suppressHydrationWarning
    >
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
              "@id": `${BASE_URL}/#organization`,
              name: "ReplayChess",
              url: BASE_URL,
              logo: `${BASE_URL}/chess-logo-bnw.png`,
              founder: {
                "@type": "Person",
                name: "Rohit Pandit",
                url: `${BASE_URL}/blog/author/rohit-pandit`,
              },
              sameAs: ["https://x.com/anaestheticdev"],
            }),
          }}
        />
        {process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_WIDGETS !== "0" && (
          <>
            <script
              src="https://unpkg.com/react-scan/dist/auto.global.js"
              crossOrigin="anonymous"
            />
            <script
              src="https://unpkg.com/react-grab/dist/index.global.js"
              crossOrigin="anonymous"
            />
            <script
              src="/pingchat-widget.js"
              data-site="chess-battle-turbo"
              data-owner="@rohit"
              data-convex-url="https://admired-yak-82.convex.cloud"
              data-position="bottom-right"
              data-color="#4ECDC4"
              data-greeting="Chat with other players!"
              defer
            ></script>
          </>
        )}
      </head>
      <body className="bg-cb-bg">
        <ThemeProvider>
          <ThemeAwareClerkProvider>
            <GoogleAnalytics />
            <Analytics />
            <SpeedInsights />
            <UserSync />
            <PostHogIdentify />
            <ThemeAwareToaster />
            <ThemeColorSync />
            <TooltipProvider>{children}</TooltipProvider>
          </ThemeAwareClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
