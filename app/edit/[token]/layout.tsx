import type { Metadata } from "next";

// Phrase-editing links unfurl as their own card, not the app mascot —
// same treatment as booth and audition links.

export const metadata: Metadata = {
  title: "Phrase Editing — Run Buddy Studio",
  description: "Polish the lines, keep the voice. One phrase per page, saved as you go.",
  openGraph: {
    title: "Phrase Editing — Run Buddy Studio",
    description: "Polish the lines, keep the voice. One phrase per page, saved as you go.",
    images: [{ url: "/og-edit.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-edit.jpg"],
  },
};

export default function EditLayout({ children }: { children: React.ReactNode }) {
  return children;
}
