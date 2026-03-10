import type { Metadata } from "next";
import localFont from "next/font/local";
import { Instrument_Serif } from "next/font/google";
import { safeJsonLd } from "@/lib/seo";

import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { UserSync } from "./components/UserSync";
import { GoogleAnalytics } from "./components/GoogleAnalytics";
import { Analytics } from "@vercel/analytics/next"

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
    images: [{ url: "/og-image.jpg", width: 1200, height: 800, alt: "ReplayChess" }],
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

const clerkAppearance = {
  variables: {
    colorBackground: '#000000',
    colorText: '#ffffff',
    colorTextSecondary: 'rgba(255, 255, 255, 0.5)',
    colorTextOnPrimaryBackground: '#000000',
    colorPrimary: '#ffffff',
    colorInputBackground: 'rgba(255, 255, 255, 0.03)',
    colorInputText: '#ffffff',
    colorNeutral: 'rgba(255, 255, 255, 0.4)',
    colorDanger: '#ef4444',
    colorSuccess: '#22c55e',
    colorWarning: '#f59e0b',
    borderRadius: '0px',
    fontFamily: "'Geist', sans-serif",
    fontFamilyButtons: "'Geist', sans-serif",
    fontSize: '14px',
    spacingUnit: '14px',
  },
  elements: {
    // Root and cards
    rootBox: {
      width: '100%',
    },
    card: {
      backgroundColor: '#000000',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      boxShadow: 'none',
      borderRadius: '0px',
      padding: '24px',
    },
    cardBox: {
      boxShadow: 'none',
    },
    // Main content area
    main: {
      gap: '24px',
    },
    page: {
      backgroundColor: '#000000',
      minHeight: '100vh',
      gap: '32px',
    },
    // Navbar in profile
    navbar: {
      backgroundColor: '#000000',
      borderRight: '1px solid rgba(255, 255, 255, 0.1)',
      padding: '24px 16px',
    },
    navbarButtons: {
      gap: '4px',
    },
    navbarButton: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '13px',
      color: 'rgba(255, 255, 255, 0.6)',
      borderRadius: '0px',
      padding: '12px 16px',
      gap: '12px',
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        color: '#ffffff',
      },
      '&[data-active="true"]': {
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        color: '#ffffff',
      },
    },
    navbarButtonIcon: {
      color: 'rgba(255, 255, 255, 0.5)',
      width: '18px',
      height: '18px',
    },
    // Headers
    header: {
      padding: '0',
      marginBottom: '24px',
    },
    headerTitle: {
      fontFamily: "'Instrument Serif', serif",
      fontSize: '32px',
      fontWeight: '400',
      color: '#ffffff',
      marginBottom: '8px',
    },
    headerSubtitle: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '14px',
      color: 'rgba(255, 255, 255, 0.4)',
      marginTop: '0',
    },
    // Profile page specific
    profilePage: {
      padding: '32px 40px',
    },
    // Profile section
    profileSection: {
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      paddingBottom: '24px',
      marginBottom: '24px',
      gap: '16px',
    },
    profileSectionHeader: {
      padding: '0',
      marginBottom: '16px',
    },
    profileSectionTitle: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '11px',
      fontWeight: '600',
      letterSpacing: '0.12em',
      textTransform: 'uppercase' as const,
      color: 'rgba(255, 255, 255, 0.4)',
      padding: '0 0 12px 0',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      marginBottom: '20px',
    },
    profileSectionTitleText: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '11px',
      letterSpacing: '0.12em',
      textTransform: 'uppercase' as const,
    },
    profileSectionContent: {
      padding: '0',
      gap: '16px',
    },
    profileSectionPrimaryButton: {
      backgroundColor: '#ffffff',
      color: '#000000',
      fontFamily: "'Geist', sans-serif",
      fontSize: '12px',
      fontWeight: '600',
      letterSpacing: '0.05em',
      textTransform: 'uppercase' as const,
      border: 'none',
      borderRadius: '0px',
      padding: '12px 20px',
      height: 'auto',
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
      },
    },
    // Accordion
    accordionTriggerButton: {
      fontFamily: "'Geist', sans-serif",
      color: '#ffffff',
      padding: '16px 20px',
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
      },
    },
    accordionContent: {
      backgroundColor: 'rgba(255, 255, 255, 0.02)',
      padding: '20px',
    },
    // Form elements
    form: {
      gap: '20px',
    },
    formField: {
      gap: '8px',
    },
    formFieldRow: {
      gap: '16px',
    },
    formFieldLabel: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '11px',
      fontWeight: '500',
      letterSpacing: '0.1em',
      textTransform: 'uppercase' as const,
      color: 'rgba(255, 255, 255, 0.5)',
      marginBottom: '0',
    },
    formFieldLabelRow: {
      marginBottom: '8px',
    },
    formFieldInput: {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      color: '#ffffff',
      fontFamily: "'Geist', sans-serif",
      fontSize: '14px',
      borderRadius: '0px',
      padding: '14px 16px',
      height: 'auto',
      '&:focus': {
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderColor: 'rgba(255, 255, 255, 0.3)',
        boxShadow: 'none',
        outline: 'none',
      },
      '&::placeholder': {
        color: 'rgba(255, 255, 255, 0.25)',
      },
    },
    formFieldInputShowPasswordButton: {
      color: 'rgba(255, 255, 255, 0.4)',
      right: '14px',
      '&:hover': {
        color: 'rgba(255, 255, 255, 0.7)',
      },
    },
    formFieldAction: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '12px',
      color: 'rgba(255, 255, 255, 0.5)',
      '&:hover': {
        color: '#ffffff',
      },
    },
    formFieldHintText: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '12px',
      color: 'rgba(255, 255, 255, 0.35)',
      marginTop: '8px',
    },
    formFieldErrorText: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '12px',
      color: '#ef4444',
      marginTop: '8px',
    },
    formFieldSuccessText: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '12px',
      color: '#22c55e',
      marginTop: '8px',
    },
    // Buttons
    formButtonPrimary: {
      backgroundColor: '#ffffff',
      color: '#000000',
      fontFamily: "'Geist', sans-serif",
      fontSize: '13px',
      fontWeight: '600',
      letterSpacing: '0.06em',
      textTransform: 'uppercase' as const,
      borderRadius: '0px',
      padding: '14px 24px',
      height: 'auto',
      marginTop: '8px',
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
      },
      '&:active': {
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
      },
    },
    formButtonReset: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '13px',
      color: 'rgba(255, 255, 255, 0.5)',
      padding: '14px 24px',
      '&:hover': {
        color: '#ffffff',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
      },
    },
    // Social buttons
    socialButtons: {
      gap: '12px',
    },
    socialButtonsBlockButton: {
      backgroundColor: 'transparent',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      color: '#ffffff',
      fontFamily: "'Geist', sans-serif",
      fontSize: '13px',
      fontWeight: '500',
      padding: '14px 20px',
      gap: '12px',
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        borderColor: 'rgba(255, 255, 255, 0.25)',
      },
    },
    socialButtonsProviderIcon: {
      width: '18px',
      height: '18px',
    },
    // Divider
    dividerRow: {
      margin: '24px 0',
      gap: '16px',
    },
    dividerLine: {
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
    },
    dividerText: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '10px',
      letterSpacing: '0.15em',
      textTransform: 'uppercase' as const,
      color: 'rgba(255, 255, 255, 0.3)',
      padding: '0 16px',
    },
    // Active devices / sessions
    activeDeviceIcon: {
      color: 'rgba(255, 255, 255, 0.6)',
      width: '20px',
      height: '20px',
    },
    activeDevice: {
      backgroundColor: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '0px',
      padding: '16px 20px',
    },
    activeDeviceListItem: {
      padding: '0',
      marginBottom: '12px',
    },
    // Badges
    badge: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '9px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      color: 'rgba(255, 255, 255, 0.7)',
      borderRadius: '0px',
      padding: '4px 8px',
    },
    badgePrimary: {
      backgroundColor: '#ffffff',
      color: '#000000',
    },
    // Menu items
    menuButton: {
      fontFamily: "'Geist', sans-serif",
      color: 'rgba(255, 255, 255, 0.7)',
      borderRadius: '0px',
      padding: '10px 14px',
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        color: '#ffffff',
      },
    },
    menuItem: {
      fontFamily: "'Geist', sans-serif",
      color: 'rgba(255, 255, 255, 0.7)',
      borderRadius: '0px',
      padding: '12px 16px',
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        color: '#ffffff',
      },
    },
    menuList: {
      backgroundColor: '#000000',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '0px',
      padding: '8px',
    },
    // Alerts
    alert: {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '0px',
      padding: '16px 20px',
      gap: '12px',
    },
    alertText: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '13px',
      color: 'rgba(255, 255, 255, 0.7)',
      lineHeight: '1.5',
    },
    alertIcon: {
      width: '18px',
      height: '18px',
    },
    // Modals
    modalBackdrop: {
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
    },
    modalContent: {
      backgroundColor: '#000000',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '0px',
      padding: '32px',
    },
    modalCloseButton: {
      color: 'rgba(255, 255, 255, 0.4)',
      padding: '8px',
      top: '20px',
      right: '20px',
      '&:hover': {
        color: '#ffffff',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
      },
    },
    // Table (for sessions etc)
    table: {
      borderColor: 'rgba(255, 255, 255, 0.08)',
    },
    tableHead: {
      backgroundColor: 'rgba(255, 255, 255, 0.02)',
    },
    // User preview
    userPreview: {
      padding: '20px',
      gap: '14px',
    },
    userPreviewAvatarContainer: {
      marginRight: '0',
    },
    userPreviewTextContainer: {
      gap: '4px',
    },
    userPreviewMainIdentifier: {
      fontFamily: "'Geist', sans-serif",
      fontWeight: '500',
      fontSize: '15px',
      color: '#ffffff',
    },
    userPreviewSecondaryIdentifier: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '13px',
      color: 'rgba(255, 255, 255, 0.4)',
    },
    // Avatar
    avatarBox: {
      borderRadius: '0px',
      border: '1px solid rgba(255, 255, 255, 0.2)',
    },
    avatarImage: {
      borderRadius: '0px',
    },
    // User button popover
    userButtonPopoverCard: {
      backgroundColor: '#000000',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '0px',
      padding: '0',
      overflow: 'hidden',
    },
    userButtonPopoverMain: {
      padding: '0',
    },
    userButtonPopoverActions: {
      padding: '8px',
      borderTop: '1px solid rgba(255, 255, 255, 0.08)',
    },
    userButtonPopoverActionButton: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '13px',
      color: 'rgba(255, 255, 255, 0.7)',
      padding: '12px 16px',
      gap: '12px',
      borderRadius: '0px',
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        color: '#ffffff',
      },
    },
    userButtonPopoverActionButtonIcon: {
      color: 'rgba(255, 255, 255, 0.5)',
      width: '16px',
      height: '16px',
    },
    userButtonPopoverFooter: {
      display: 'none',
    },
    // Footer
    footer: {
      display: 'none',
    },
    footerAction: {
      marginTop: '24px',
      gap: '6px',
    },
    footerActionText: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '13px',
      color: 'rgba(255, 255, 255, 0.4)',
    },
    footerActionLink: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '13px',
      fontWeight: '500',
      color: '#ffffff',
      '&:hover': {
        color: 'rgba(255, 255, 255, 0.8)',
      },
    },
    // Identity preview
    identityPreview: {
      backgroundColor: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      borderRadius: '0px',
      padding: '16px 20px',
      gap: '14px',
    },
    identityPreviewText: {
      fontFamily: "'Geist', sans-serif",
      color: '#ffffff',
      fontSize: '14px',
    },
    identityPreviewEditButton: {
      color: 'rgba(255, 255, 255, 0.5)',
      padding: '8px',
      '&:hover': {
        color: '#ffffff',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
      },
    },
    // OTP
    otpCodeField: {
      gap: '12px',
    },
    otpCodeFieldInput: {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      borderRadius: '0px',
      color: '#ffffff',
      fontFamily: "'Geist', sans-serif",
      fontSize: '20px',
      width: '48px',
      height: '56px',
      '&:focus': {
        borderColor: 'rgba(255, 255, 255, 0.4)',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
      },
    },
    // Phone input
    phoneInputBox: {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '0px',
      padding: '0',
      '&:focus-within': {
        borderColor: 'rgba(255, 255, 255, 0.3)',
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
      },
    },
    // Scrollbar - only visible when needed
    scrollBox: {
      overflow: 'auto',
      '&::-webkit-scrollbar': {
        width: '6px',
        height: '6px',
      },
      '&::-webkit-scrollbar-track': {
        background: 'transparent',
      },
      '&::-webkit-scrollbar-thumb': {
        background: 'transparent',
        borderRadius: '0px',
      },
      '&:hover::-webkit-scrollbar-thumb': {
        background: 'rgba(255, 255, 255, 0.15)',
      },
      '&::-webkit-scrollbar-thumb:hover': {
        background: 'rgba(255, 255, 255, 0.25)',
      },
      scrollbarWidth: 'thin',
      scrollbarColor: 'transparent transparent',
      '&:hover': {
        scrollbarColor: 'rgba(255, 255, 255, 0.15) transparent',
      },
    },
    pageScrollBox: {
      backgroundColor: '#000000',
      padding: '40px',
      overflow: 'auto',
      '&::-webkit-scrollbar': {
        width: '6px',
      },
      '&::-webkit-scrollbar-track': {
        background: 'transparent',
      },
      '&::-webkit-scrollbar-thumb': {
        background: 'transparent',
      },
      '&:hover::-webkit-scrollbar-thumb': {
        background: 'rgba(255, 255, 255, 0.15)',
      },
    },
    // Select
    selectButton: {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '0px',
      padding: '14px 16px',
      color: '#ffffff',
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
      },
    },
    selectOptionsContainer: {
      backgroundColor: '#000000',
      border: '1px solid rgba(255, 255, 255, 0.1)',
      borderRadius: '0px',
      padding: '8px',
    },
    selectOption: {
      fontFamily: "'Geist', sans-serif",
      fontSize: '13px',
      padding: '12px 16px',
      borderRadius: '0px',
      '&:hover': {
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
      },
      '&[data-selected="true"]': {
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
      },
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider appearance={clerkAppearance}>
      <html lang="en">
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
          className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} bg-black`}
        >
          <GoogleAnalytics />
          <Analytics />
          <UserSync />
          <Toaster
            theme="dark"
            position="top-center"
            toastOptions={{
              style: {
                background: '#0a0a0a',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#ffffff',
                borderRadius: '0px',
              },
            }}
          />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}