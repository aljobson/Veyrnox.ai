// Public sitemap for veyrnox.ai. Kept in sync with the marketing routes
// declared in next.config.mjs rewrites (root, pricing, presets, design-system).
export default function sitemap() {
  const base = 'https://veyrnox.ai';
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1.0 },
    { url: `${base}/pricing`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/presets`, lastModified: now, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/design-system`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
  ];
}
