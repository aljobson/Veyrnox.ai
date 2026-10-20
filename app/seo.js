import { serializeJsonLd } from '../lib/jsonLd';

// Shared SEO constants for the root layout and public pages.
export const SITE_URL = 'https://veyrnox.ai';

// 1200x630 social card in public/. Referenced explicitly rather than through
// the app/opengraph-image.* file convention: any route that sets its own
// `openGraph` object — /pricing, /presets and /design-system all do — drops
// the convention's auto-injected image, leaving those pages with no card.
export const OG_IMAGE = {
  url: '/og.png',
  width: 1200,
  height: 630,
  alt: 'Veyrnox.ai — credit-metered AI video, image and audio generation, price on the receipt.',
};

// Next merges nested metadata objects shallowly. Every route that supplies an
// Open Graph title or URL must spread this base or it drops the site name and
// social card inherited from the root layout.
export const OPEN_GRAPH_BASE = {
  type: 'website',
  siteName: 'Veyrnox.ai',
  images: [OG_IMAGE],
};

export const ORG_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: 'Veyrnox Ltd',
      alternateName: 'Veyrnox.ai',
      url: SITE_URL,
      logo: `${SITE_URL}/icon.svg`,
      email: 'legal@veyrnox.com',
      legalName: 'Veyrnox Ltd',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Suite RA01, 195-197 Wood Street',
        addressLocality: 'London',
        postalCode: 'E17 3NU',
        addressCountry: 'GB',
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: 'Veyrnox.ai',
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'en-GB',
    },
    {
      '@type': 'WebApplication',
      '@id': `${SITE_URL}/#web-application`,
      name: 'Veyrnox.ai',
      url: SITE_URL,
      description: 'Credit-metered AI video, image and audio generation with prices shown before generation and automatic refunds for failed jobs.',
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Web',
      browserRequirements: 'Requires JavaScript and a modern web browser.',
      provider: { '@id': `${SITE_URL}/#organization` },
      publisher: { '@id': `${SITE_URL}/#organization` },
      isPartOf: { '@id': `${SITE_URL}/#website` },
    },
  ],
};

/**
 * Renders JSON-LD as a script child without using a raw-markup escape hatch.
 * serializeJsonLd neutralises HTML end tags even when data comes from a live
 * catalog rather than a build-time constant.
 */
export function JsonLd({ data }) {
  return <script type="application/ld+json">{serializeJsonLd(data)}</script>;
}
