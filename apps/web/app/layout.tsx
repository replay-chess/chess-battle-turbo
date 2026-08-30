import type { Metadata } from "next";
import localFont from "next/font/local";
import { Instrument_Serif } from "next/font/google";
import { BASE_URL, safeJsonLd } from "@/lib/seo";

import "./globals.css";
import { UserSync } from "./components/UserSync";
import { GoogleAnalytics } from "./components/GoogleAnalytics";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "./components/ThemeProvider";
import { ThemeAwareClerkProvider } from "./components/ThemeAwareClerkProvider";
import { ThemeAwareToaster } from "./components/ThemeAwareToaster";
import { SpeedInsights } from "@vercel/speed-insights/next";

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
  width: "device-width",
  initialScale: 1,
  themeColor: "#171717",
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
        height: 800,
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
  // Search engine ownership verification. Set the env vars after generating
  // the tokens in Google Search Console / Bing Webmaster Tools — see SEO.md.
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION && {
      google: process.env.GOOGLE_SITE_VERIFICATION,
    }),
    ...(process.env.BING_SITE_VERIFICATION && {
      other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION },
    }),
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
    <html lang="en" className="light" suppressHydrationWarning>
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
