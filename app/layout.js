import { ReticleDev } from './reticle-dev';
// ADR-0060: every HTML document must receive fresh nonced framework scripts.
export const dynamic = 'force-dynamic';

import './globals.css';
import localFont from "next/font/local";
import ToasterMount from '../components/ToasterMount';
import AuthGate from '../components/AuthGate.jsx';
import SessionHydration from '../components/SessionHydration.jsx';
import AnalyticsProvider, { analyticsEnabled } from '../components/AnalyticsProvider.jsx';
import SiteChrome from './veyrnox/_components/SiteChrome';
import ServiceStatusBanner from './veyrnox/_components/ServiceStatusBanner';
import { I18nProvider } from '../components/I18nProvider';
import { cookies } from 'next/headers';
import { getPublicT } from '../lib/i18n/server';
import { THEME_COOKIE, parseTheme } from '../lib/themePreference.mjs';
import { localeInfo, localesEnabled } from '../lib/i18n/locales.mjs';
import { OG_IMAGE, OPEN_GRAPH_BASE, ORG_LD, JsonLd } from './seo';

// Self-hosted (OFL, app/fonts): next/font/google fetched these from Google at
// build time, and a failed fetch failed production deploys (2026-09-22).
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
});

export async function generateMetadata() {
  const { t } = await getPublicT();
  const TITLE = t('meta.title');
  const DESCRIPTION = t('meta.description');
  return {
  // Absolute URLs for canonical + Open Graph. Without it Next emits
  // relative og:url values that no crawler resolves.
  metadataBase: new URL('https://veyrnox.ai'),
  title: {
    default: TITLE,
    // Per-page titles set only their own half.
    template: t('meta.siteTemplate'),
  },
  description: DESCRIPTION,
  applicationName: 'Veyrnox.ai',
  alternates: { canonical: '/' },
  openGraph: {
    ...OPEN_GRAPH_BASE,
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
  },
  // summary_large_image, not summary: with a 1200x630 card the small variant
  // crops it to a square thumbnail.
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: [OG_IMAGE.url] },
};

}

// The remembered appearance, from the cookie the toggle writes. Read on the
// server so <html> carries it in the first response: no flash, no inline script.
async function storedTheme() {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}

// Dark is the brand default; the theme toggle overrides it per browser.
export async function generateViewport() {
  const choice = await storedTheme();
  return {
    themeColor: choice === 'light' ? '#FFFFFF' : choice === 'system'
      ? [{ media: '(prefers-color-scheme: light)', color: '#FFFFFF' }, { media: '(prefers-color-scheme: dark)', color: '#0A0A0B' }]
      : '#0A0A0B',
    colorScheme: 'dark light',
  };
}

export default async function RootLayout({ children }) {
  const { locale, t, messages } = await getPublicT();
  const info = localeInfo(locale);
  const theme = await storedTheme();
  return (
    <html lang={info.hreflang} dir={info.dir} data-theme={theme || undefined} data-scroll-behavior="smooth" className={inter.variable}>
      <body>
        <I18nProvider locale={locale} enabled={localesEnabled()} messages={messages}>
        <AnalyticsProvider>
          {process.env.NODE_ENV === 'development' ? <ReticleDev /> : null}
          <a href="#main" className="vx-skip rounded-full bg-vx-accent px-4 py-2 text-sm font-extrabold text-vx-accent-ink">
            {t('ui.skip')}
          </a>
          <ServiceStatusBanner />
          {/* #main is the page's own Main (app/veyrnox/_components/Main.js): it
              starts after the nav, so this link skips it. */}
          {children}
          <SiteChrome analyticsEnabled={analyticsEnabled} />
          <ToasterMount />
          <AuthGate />
          <SessionHydration />
          <JsonLd data={ORG_LD} />
        </AnalyticsProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
