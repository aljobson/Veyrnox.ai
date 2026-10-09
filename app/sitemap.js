import { SITE_URL } from './seo';
import { listModels } from './veyrnox/_lib/modelPages';
import { PRESETS } from './veyrnox/_lib/templates';
import { GUIDES } from './veyrnox/_lib/guides';

// Rendered per request so /models/<id> entries follow the live catalog.
export const dynamic = 'force-dynamic';

// Public sitemap for veyrnox.ai. Every URL is the public path produced by the
// rewrites in next.config.mjs, never the app/veyrnox/* source path. Announced
// to crawlers by the Sitemap line in app/robots.js.
//
// Absent on purpose: /app and /m are auth-gated and disallowed in robots.txt,
// and /design-system sets robots.index false in its own layout — listing a
// page we ask not to be indexed is a contradiction Search Console reports as
// an error.
export default async function sitemap() {
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
    ...PRESETS.map((t) => page(`/presets/${t.id}`, 'monthly', 0.5)),
    page('/models', 'weekly', 0.8),
    page('/tools', 'weekly', 0.7),
    page('/guides', 'monthly', 0.6),
    ...GUIDES.map((g) => page(`/guides/${g.id}`, 'monthly', 0.5)),
    page('/social-cinema', 'weekly', 0.7),
    page('/legal/terms', 'yearly', 0.3),
    page('/legal/privacy', 'yearly', 0.3),
    page('/legal/gdpr', 'yearly', 0.3),
    page('/legal/refund', 'yearly', 0.3),
    page('/legal/aup', 'yearly', 0.3),
    ...(await modelPages(page)),
  ];
}

// The catalog being unreachable must not take the sitemap down with it.
async function modelPages(page) {
  try {
    return (await listModels()).map((m) => page(`/models/${encodeURIComponent(m.id)}`, 'weekly', 0.6));
  } catch (err) {
    console.error('[sitemap] catalog unavailable; model pages omitted:', err && err.message);
    return [];
  }
}
