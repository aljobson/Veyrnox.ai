// robots.txt. The origin used to 404 here, so Cloudflare served its own
// managed placeholder — comments only, no Sitemap line. The sitemap was never
// announced to a crawler that had not already found the domain.
export default function robots() {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Auth-gated product surfaces and the gateway: nothing here belongs in
      // an index, and a crawl of /app spends budget on a sign-in wall. A rule
      // is a prefix match, so a bare '/app' or '/m' also closed /apple-icon.png,
      // /models, every /models/* page in the sitemap and /media/*. Each is
      // written twice instead: '/app/' for what is under it and '/app$' ('$'
      // pins the end of the URL) for the page itself. tests/robots.test.mjs
      // checks every sitemap path against these.
      disallow: ['/api/', '/auth/', '/app/', '/app$', '/m/', '/m$'],
    },
    sitemap: 'https://veyrnox.ai/sitemap.xml',
    host: 'https://veyrnox.ai',
  };
}
