// ADR-0049: every HTML document must receive fresh nonced framework scripts.
export const dynamic = 'force-dynamic';

import './globals.css';
import localFont from "next/font/local";
import ToasterMount from '../components/ToasterMount';
import AuthGate from '../components/AuthGate.jsx';
import SiteChrome from './veyrnox/_components/SiteChrome';
import { OG_IMAGE, ORG_LD, JsonLd } from './seo';

// Self-hosted (OFL, app/fonts): next/font/google fetched these from Google at
// build time, and a failed fetch failed production deploys (2026-09-22).
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
});

const TITLE = 'Veyrnox.ai — AI video & image, priced per generation';
const DESCRIPTION =
  'Credit-metered AI video, image and audio generation. Every generation shows its price before you spend, and failed jobs refund automatically.';

export const metadata = {
  // Absolute URLs for canonical + Open Graph. Without it Next emits
  // relative og:url values that no crawler resolves.
  metadataBase: new URL('https://veyrnox.ai'),
  title: {
    default: TITLE,
    // Per-page titles set only their own half.
    template: '%s — Veyrnox.ai',
  },
  description: DESCRIPTION,
  applicationName: 'Veyrnox.ai',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Veyrnox.ai',
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
    images: [OG_IMAGE],
  },
  // summary_large_image, not summary: with a 1200x630 card the small variant
  // crops it to a square thumbnail.
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
};

// Dark is the brand default; the theme toggle overrides it per browser.
export const viewport = {
  themeColor: '#0A0A0B',
  colorScheme: 'dark light',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.variable}>
        <a href="#main" className="vx-skip rounded-full bg-vx-accent px-4 py-2 text-sm font-extrabold text-vx-accent-ink">
          Skip to content
        </a>
        {/* tabIndex -1 so the skip link and the back-to-top button can land
            focus here without making the region itself tabbable. */}
        <main id="main" tabIndex={-1}>{children}</main>
        <SiteChrome />
        <ToasterMount />
        <AuthGate />
        <JsonLd data={ORG_LD} />
      </body>
    </html>
  );
}
