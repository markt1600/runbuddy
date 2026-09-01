import type { Metadata } from "next";

// Booth links unfurl as a recording-session card, not the app mascot —
// the actor's first impression of the studio starts in the chat preview.

export const metadata: Metadata = {
  title: "Voice Session — Run Buddy Studio",
  description: "Your recording booth is ready. Progress saves as you go — come back anytime with this link.",
  openGraph: {
    title: "Voice Session — Run Buddy Studio",
    description: "Your recording booth is ready. Progress saves as you go — come back anytime with this link.",
    images: [{ url: "/og-studio.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-studio.jpg"],
  },
};

export default function RecordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
