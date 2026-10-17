import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { REGISTRY } from '../lib/modelCapabilities.js';
import { ODDLING_ARCHETYPES } from '../app/veyrnox/_lib/character.js';

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

// The public Oddlings gallery (ODDLINGS_PUBLIC_ENABLED): crawlable, in the
// sitemap only while open, and the signed-in studio next to it stays closed.
async function sitemapUrls(flag) {
    const previous = process.env.ODDLINGS_PUBLIC_ENABLED;
    const error = console.error;
    console.error = () => {};
    try {
        if (flag === undefined) delete process.env.ODDLINGS_PUBLIC_ENABLED;
        else process.env.ODDLINGS_PUBLIC_ENABLED = flag;
        return (await sitemap()).map((entry) => entry.url);
    } finally {
        console.error = error;
        if (previous === undefined) delete process.env.ODDLINGS_PUBLIC_ENABLED;
        else process.env.ODDLINGS_PUBLIC_ENABLED = previous;
    }
}

test('the sitemap lists the Oddlings gallery and every character only while the flag is on', async () => {
    const castIds = ODDLING_ARCHETYPES.map((a) => a.id);
    assert.ok(castIds.length >= 32);
    const open = (await sitemapUrls('true')).filter((url) => url.startsWith(`${SITE_URL}/oddlings`));
    assert.deepEqual(open, [`${SITE_URL}/oddlings`, ...castIds.map((id) => `${SITE_URL}/oddlings/${id}`)]);
    assert.equal(open.length, castIds.length + 1, 'the cast plus the gallery page');
    for (const url of open) assert.ok(allowed(rules, url.slice(SITE_URL.length)), `${url} is listed but disallowed`);
    for (const flag of [undefined, 'false', '', 'TRUE', '1']) {
        const urls = await sitemapUrls(flag);
        assert.deepEqual(urls.filter((url) => url.includes('/oddlings')), [], `flag ${JSON.stringify(flag)} must list nothing`);
        assert.ok(urls.length > 10, 'the rest of the sitemap is unaffected');
    }
});

test('the public gallery may be crawled and the studio behind it may not', () => {
    for (const path of ['/oddlings', '/oddlings/duchess-volume', '/oddlings/portraits/duchess-volume.webp', '/oddlings/oddling-cast.webp']) {
        assert.ok(allowed(rules, path), `${path} should be crawlable`);
    }
    for (const path of ['/app/oddlings', '/app/oddlings?oddling=duchess-volume']) {
        assert.ok(!allowed(rules, path), `${path} should stay disallowed`);
    }
    assert.ok(rules.disallow.includes('/app/') && rules.disallow.includes('/app$'), '/app is not carved out');
});

test('robots.txt still announces the sitemap', () => {
    // scripts/check-site-health.mjs fails a deploy without the Sitemap line.
    assert.equal(sitemapUrl, `${SITE_URL}/sitemap.xml`);
});

test('sitemap lists eligible transform detail pages while excluding gated and private editor models', async () => {
    const originalFetch = globalThis.fetch;
    const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'EDITOR_AUDIO_STEMS_ENABLED'];
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const privateEndpoint = Object.keys(REGISTRY).find((endpoint) => REGISTRY[endpoint].inputs.clips);
    const row = (id, endpoint, gated_flag = false) => ({ id, name: id, modality: 'audio-to-audio', provider_endpoint: endpoint, credits_5s: 6, gated_flag });
    try {
        Object.assign(process.env, { SUPABASE_URL: 'https://sitemap.test', SUPABASE_SERVICE_ROLE_KEY: 'test', EDITOR_AUDIO_STEMS_ENABLED: 'true' });
        globalThis.fetch = async (url) => {
            assert.equal(new URL(url).searchParams.get('active'), 'eq.true');
            return Response.json([row('demucs-stems', 'fal-ai/demucs'), row('gated-stems', 'fal-ai/demucs', true), row('private-editor', privateEndpoint)]);
        };
        const entries = await sitemap();
        const urls = entries.map((entry) => entry.url);
        assert.ok(urls.includes(`${SITE_URL}/models/demucs-stems`));
        assert.ok(!urls.includes(`${SITE_URL}/models/gated-stems`));
        assert.ok(!urls.includes(`${SITE_URL}/models/private-editor`));
        process.env.EDITOR_AUDIO_STEMS_ENABLED = 'false';
        assert.ok(!(await sitemap()).some((entry) => entry.url === `${SITE_URL}/models/demucs-stems`));
    } finally {
        globalThis.fetch = originalFetch;
        for (const name of names) {
            if (previous[name] === undefined) delete process.env[name];
            else process.env[name] = previous[name];
        }
    }
});
