import type { Metadata } from "next";

// Audition links get their own WhatsApp/OG identity — a casting-call card
// instead of the app mascot. metadataBase from the root layout makes the
// image URL absolute.

export const metadata: Metadata = {
  title: "Voice Audition — Run Buddy Studio",
  description: "One line, in character, full commitment. Record your audition right in the browser.",
  openGraph: {
    title: "Voice Audition — Run Buddy Studio",
    description: "One line, in character, full commitment. Record your audition right in the browser.",
    images: [{ url: "/og-audition.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-audition.jpg"],
  },
};

export default function AuditionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
