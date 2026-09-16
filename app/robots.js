// robots.txt. The origin used to 404 here, so Cloudflare served its own
// managed placeholder — comments only, no Sitemap line. The sitemap was never
// announced to a crawler that had not already found the domain.
export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Auth-gated product surfaces and the gateway: nothing here belongs in
      // an index, and a crawl of /app spends budget on a sign-in wall. Prefix
      // match, so '/app' covers both /app and /app/create — no public route
      // shares either prefix.
      disallow: ['/api/', '/auth/', '/app', '/m'],
    },
    sitemap: 'https://veyrnox.ai/sitemap.xml',
    host: 'https://veyrnox.ai',
  };
}
