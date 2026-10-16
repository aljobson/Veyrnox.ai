import { AUTO_PRODUCT_INVENTORY } from '../lib/generatedProductInventory.js';

export const PAGE_TEMPLATES = AUTO_PRODUCT_INVENTORY.map(({ route, source }) => ({ route, source }));
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function templateMatches(template, pathname) {
  const pattern = template.split('/').map((part) => /^\[.+\]$/.test(part) ? '[^/]+' : escape(part)).join('/');
  return new RegExp(`^${pattern}$`).test(pathname);
}

function validSavedReviewFixture(fixture) {
  if (!fixture) return false;
  const query = new URL(fixture, 'https://fixture.invalid').searchParams;
  // Mirror the page's required scalar query values: duplicate keys become
  // arrays in Next searchParams and cannot identify a saved review either.
  return query.getAll('project').length === 1 && query.getAll('revision').length === 1
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.get('project'))
    && /^[1-9][0-9]{0,8}$/.test(query.get('revision'));
}

/** Concrete sitemap URLs plus one explicit missing-fixture path for every otherwise uncovered template. */
export function buildPageManifest(sitemapPaths = [], fixtures = {}) {
  if (Object.keys(fixtures).some((route) => !PAGE_TEMPLATES.some((entry) => entry.route === route))) {
    throw new Error('QA fixtures contain an unknown page template');
  }
  const publicPaths = [...new Set(sitemapPaths)].filter((pathname) => typeof pathname === 'string' && pathname.startsWith('/') && !pathname.startsWith('//'));
  return PAGE_TEMPLATES.flatMap(({ route, source }) => {
    const fixture = fixtures[route];
    if (fixture !== undefined && (typeof fixture !== 'string' || !fixture.startsWith('/') || fixture.startsWith('//') || !templateMatches(route, fixture.split('?')[0]))) {
      throw new Error(`Invalid QA fixture for ${route}`);
    }
    const concrete = publicPaths.filter((pathname) => templateMatches(route, pathname));
    const paths = fixture ? [fixture] : concrete.length ? concrete : [route.replace(/\[[^\]]+\]/g, 'qa-missing-fixture')];
    return paths.map((pathname) => ({ template: route, source, pathname,
      sensitive: Boolean(fixture),
      mode: (route === '/app/editor/review' && !validSavedReviewFixture(fixture)) || (!fixture && !concrete.length && route.includes('[')) ? 'negative-path' : 'render',
      access: route.startsWith('/app/admin') ? 'admin-gate' : route.startsWith('/app') || route === '/oauth/consent' ? 'account' : 'public',
    }));
  });
}

export function sitemapPaths(xml, baseURL) {
  const origin = new URL(baseURL).origin;
  return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].flatMap(([, location]) => {
    const url = new URL(location.replaceAll('&amp;', '&'), baseURL);
    // Staging's sitemap intentionally canonicalizes URLs to the production host.
    if (url.origin !== origin && url.hostname !== 'veyrnox.ai') throw new Error('Unexpected sitemap origin');
    return [url.pathname];
  });
}
