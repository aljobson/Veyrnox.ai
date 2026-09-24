// Shared SEO constants for the root layout and the landing page.
export const SITE_URL = 'https://veyrnox.ai';

// 1200x630 social card in public/. Referenced explicitly rather than through
// the app/opengraph-image.* file convention: any route that sets its own
// `openGraph` object — /pricing, /presets and /design-system all do — drops
// the convention's auto-injected image, leaving those pages with no card.
export const OG_IMAGE = {
  url: '/og.png',
  width: 1200,
  height: 630,
  alt: 'Veyrnox.ai — credit-metered AI video, image and audio generation, priced on the button.',
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
  ],
};

/**
 * Renders JSON-LD. React 19 emits a <script> element's string child verbatim,
 * with no HTML escaping, so this needs none of the raw-markup escape hatches
 * the CI "Grep gates" step bans outright (that gate matches its own comments,
 * hence the circumlocution). Pass only build-time constants: a raw script
 * child would let a `</script>` inside a value break out.
 */
export function JsonLd({ data }) {
  return <script type="application/ld+json">{JSON.stringify(data)}</script>;
}
