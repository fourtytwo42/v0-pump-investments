import type React from "react"
import { Inter, Quicksand } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import Script from "next/script"
import { Analytics } from "@vercel/analytics/react"
import { Suspense } from "react"

const inter = Inter({ subsets: ["latin"], display: "swap" })
const quicksand = Quicksand({ subsets: ["latin"], weight: ["300", "500", "700"], display: "swap" })

// Replace the simple metadata object with this comprehensive metadata configuration
export const metadata = {
  // Basic metadata
  title: {
    default: "Pump.Investments Lite | Real-time Token Tracker for pump.fun",
    template: "%s | Pump.Investments Lite",
  },
  description:
    "Track, analyze, and monitor tokens on pump.fun in real-time. Set price alerts, favorite tokens, and get AI-powered insights with PI Bot.",
  keywords: [
    "pump.fun",
    "token tracker",
    "cryptocurrency",
    "market cap",
    "trading",
    "solana",
    "token alerts",
    "crypto dashboard",
  ],
  authors: [{ name: "Pump.Investments Team" }],
  creator: "Pump.Investments",
  publisher: "Pump.Investments",

  // Canonical URL - replace with your actual domain when deployed
  metadataBase: new URL("https://pump.investments"),
  alternates: {
    canonical: "/",
  },

  // Favicon and app icons
  icons: {
    icon: [{ url: "/logo.png" }, { url: "/favicon.ico" }],
    apple: "/logo.png",
    shortcut: "/logo.png",
  },

  // Open Graph metadata for social sharing
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://pump.investments",
    title: "Pump.Investments Lite | Real-time Token Tracker for pump.fun",
    description:
      "Track, analyze, and monitor tokens on pump.fun in real-time. Set price alerts, favorite tokens, and get AI-powered insights with PI Bot.",
    siteName: "Pump.Investments Lite",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Pump.Investments Lite Dashboard Preview",
      },
    ],
  },

  // Twitter card metadata
  twitter: {
    card: "summary_large_image",
    title: "Pump.Investments Lite | Real-time Token Tracker for pump.fun",
    description:
      "Track, analyze, and monitor tokens on pump.fun in real-time. Set price alerts, favorite tokens, and get AI-powered insights with PI Bot.",
    images: ["/og-image.png"],
    creator: "@PumpInvestments",
  },

  // Robots directives
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-video-preview": -1,
      "max-snippet": -1,
    },
  },

  // Verification for search console
  verification: {
    google: "google-site-verification=your-verification-code",
  },

  // App metadata for PWA
  applicationName: "Pump.Investments Lite",
  appleWebApp: {
    capable: true,
    title: "Pump.Investments Lite",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  manifest: "/manifest.json",
    generator: 'v0.app'
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#111827" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Additional meta tags that can't be added via the metadata object */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" href="/logo.png" />
      </head>
      <body className={inter.className}>
        <Suspense fallback={null}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
            <Analytics />
          </ThemeProvider>
        </Suspense>

        {/* Structured data for rich search results */}
        <Script
          id="structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Pump.Investments Lite",
              description:
                "Track, analyze, and monitor tokens on pump.fun in real-time. Set price alerts, favorite tokens, and get AI-powered insights with PI Bot.",
              applicationCategory: "FinanceApplication",
              operatingSystem: "Web",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              screenshot: "/og-image.png",
              featureList: "Real-time token tracking, Price alerts, Favorites system, AI-powered insights",
              author: {
                "@type": "Organization",
                name: "Pump.Investments",
              },
            }),
          }}
        />
      </body>
    </html>
  )
}
