import { SITE_URL } from './seo';

// Public sitemap for veyrnox.ai. Every URL is the public path produced by the
// rewrites in next.config.mjs, never the app/veyrnox/* source path. Announced
// to crawlers by the Sitemap line in app/robots.js.
//
// Absent on purpose: /app and /m are auth-gated and disallowed in robots.txt,
// and /design-system sets robots.index false in its own layout — listing a
// page we ask not to be indexed is a contradiction Search Console reports as
// an error.
export default function sitemap() {
  const now = new Date();
  const page = (path, changeFrequency, priority) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });
  return [
    page('', 'weekly', 1.0),
    page('/pricing', 'monthly', 0.9),
    page('/presets', 'weekly', 0.7),
    page('/social-cinema', 'weekly', 0.7),
    page('/legal/terms', 'yearly', 0.3),
    page('/legal/privacy', 'yearly', 0.3),
    page('/legal/gdpr', 'yearly', 0.3),
    page('/legal/refund', 'yearly', 0.3),
    page('/legal/aup', 'yearly', 0.3),
  ];
}
