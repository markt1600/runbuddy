import type { Metadata, Viewport } from "next";
import { Fraunces, Newsreader, JetBrains_Mono } from "next/font/google";
import "leaflet/dist/leaflet.css"; // route map on the run detail page
import "./globals.css";

// Self-hosted at build time rather than linked from Google. This is an
// installed PWA that runs outdoors on flaky mobile data, so an external
// stylesheet request would be the one thing standing between a runner and
// legible numbers.
// Weights are trimmed to what the stylesheet and run card actually set —
// this loads on a phone, outdoors, so every unused cut is dead weight on the
// first install. If you add a new weight in CSS, add it here too, or the
// browser will synthesize a faux version without telling you.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600", "800"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-body",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Run Buddy",
  description: "Your AI running trainer — pick a persona, press start, get coached.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Run Buddy",
  },
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f5efe2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${newsreader.variable} ${jetbrains.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
