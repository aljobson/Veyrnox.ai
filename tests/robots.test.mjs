import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// app/seo.js also holds a JSX component, which plain Node cannot load, so the
// sitemap is given the one constant it takes from there.
const SITE_URL = readFileSync(new URL('../app/seo.js', import.meta.url), 'utf8').match(/export const SITE_URL = '([^']+)';/)[1];
// Next resolves the sitemap's extensionless relative imports through its
// bundler; plain Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `const SEO = 'data:text/javascript,' + encodeURIComponent('export const SITE_URL = ${JSON.stringify(SITE_URL)};');
    export async function resolve(s, c, next) {
        if (s === './seo') return { url: SEO, shortCircuit: true };
        return next(/^\\.\\.?\\//.test(s) && !/\\.(m?js|json)$/.test(s) ? s + '.js' : s, c);
    }`,
));

const { default: robots } = await import('../app/robots.js');
const { default: sitemap } = await import('../app/sitemap.js');

// How a crawler reads a rule: a path prefix, `$` pins the end of the URL, the
// longest matching rule wins and allow wins a tie.
const matches = (rule, path) => (rule.endsWith('$') ? path === rule.slice(0, -1) : path.startsWith(rule));
function allowed(rules, path) {
    const longest = (list) => Math.max(-1, ...[].concat(list || []).filter((r) => matches(r, path)).map((r) => r.length));
    return longest(rules.allow) >= longest(rules.disallow);
}

const { rules, sitemap: sitemapUrl } = robots();

test('every page in the sitemap may be crawled', async () => {
    // The catalog is not reachable from a unit test, so the model pages are
    // left out here (and say so on stderr); they are covered by name below.
    const error = console.error;
    console.error = () => {};
    let entries;
    try { entries = await sitemap(); } finally { console.error = error; }
    assert.ok(entries.length > 10, 'the sitemap should list the public pages');
    for (const { url } of entries) {
        assert.ok(url.startsWith(SITE_URL), `${url} is not on the site`);
        const path = url.slice(SITE_URL.length) || '/';
        assert.ok(allowed(rules, path), `${path} is in the sitemap but robots.txt disallows it`);
    }
});

test('public paths that only share a first letter with /app or /m stay open', () => {
    for (const path of ['/models', '/models/wan-2.5-kie', '/models/midjourney-v7', '/media/social/token', '/apple-icon.png']) {
        assert.ok(allowed(rules, path), `${path} should be crawlable`);
    }
});

test('the signed-in app, the short links, the gateway and the auth callback stay closed', () => {
    for (const path of ['/app', '/app/', '/app/create', '/m', '/m/', '/m/abc', '/api/v1/jobs', '/auth/callback']) {
        assert.ok(!allowed(rules, path), `${path} should be disallowed`);
    }
});

test('robots.txt still announces the sitemap', () => {
    // scripts/check-site-health.mjs fails a deploy without the Sitemap line.
    assert.equal(sitemapUrl, `${SITE_URL}/sitemap.xml`);
});
