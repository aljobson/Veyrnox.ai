import { readFileSync } from 'node:fs';
import { mapAppLink } from '../apps/mobile/src/lib/appLinks.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    appleAppSiteAssociation, androidAssetLinks, associationResponse,
    APPLE_TEAM_ID, ANDROID_SHA256_FINGERPRINTS, APP_LINK_PATHS,
} from '../lib/mobileAppLinks.js';
import { GET as aasa } from '../app/.well-known/apple-app-site-association/route.js';
import { GET as assetlinks } from '../app/.well-known/assetlinks.json/route.js';

const FP = Array.from({ length: 32 }, () => 'AB').join(':');

test('Android file fails closed until fingerprints are set', async () => {
    assert.match(APPLE_TEAM_ID, /^[A-Z0-9]{10}$/);
    assert.deepEqual(ANDROID_SHA256_FINGERPRINTS, []);
    const res = assetlinks();
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(aasa().status, 200);
});

test('rejects malformed values', () => {
    assert.equal(appleAppSiteAssociation('abc'), null);
    assert.equal(appleAppSiteAssociation('team123456'), null);
    assert.equal(androidAssetLinks(['AB:CD']), null);
    assert.equal(androidAssetLinks([FP, 'nope']), null);
});

test('apple file shape and paths', () => {
    const body = appleAppSiteAssociation('ABCDE12345');
    const d = body.applinks.details[0];
    assert.deepEqual(d.appIDs, ['ABCDE12345.ai.veyrnox.app']);
    assert.deepEqual(d.components.map((c) => c['/']), APP_LINK_PATHS);
    assert.deepEqual(APP_LINK_PATHS, [
        '/app/library', '/app/library/*', '/app/chat', '/app/chat/*', '/app/create', '/app/create/*',
        '/app/credits', '/app/account', '/app/publish', '/app/publish/*', '/app/video-agent',
        '/social-cinema/*', '/oauth/consent', '/social/review/*', '/social/team/invite/*',
    ]);
    assert.ok(d.components.some((c) => c['/'] === '/social/team/invite/*'));
    assert.deepEqual(body.webcredentials, { apps: ['ABCDE12345.ai.veyrnox.app'] });
});

test('android file shape', () => {
    const [entry] = androidAssetLinks([FP]);
    assert.deepEqual(entry.relation, ['delegate_permission/common.handle_all_urls']);
    assert.equal(entry.target.package_name, 'ai.veyrnox.app');
    assert.deepEqual(entry.target.sha256_cert_fingerprints, [FP]);
});

test('configured response is json, cacheable, not a redirect', async () => {
    const res = associationResponse(appleAppSiteAssociation('ABCDE12345'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/json');
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
    assert.equal(res.headers.get('location'), null);
    assert.ok((await res.json()).applinks);
});

test('B4: every handled web route is covered by AASA and Android intent filters', () => {
    const config = JSON.parse(readFileSync(new URL('../apps/mobile/app.json', import.meta.url), 'utf8'));
    const source = readFileSync(new URL('../apps/mobile/src/lib/appLinks.ts', import.meta.url), 'utf8');
    const keys = name => [...source.match(new RegExp(String.raw`const ${name}[^=]*= \{([\s\S]*?)\n\};`))[1].matchAll(/^    ['"]?([a-z-]+)['"]?:/gm)].map(m => m[1]);
    const id = '11111111-1111-4111-8111-111111111111';
    const paths = [...keys('SECTIONS').map(s => `/app/${s}`), ...keys('PUBLISH_SECTIONS').map(s => `/app/publish/${s}`),
        `/app/library/${id}`, `/app/chat/${id}`, '/app/create/flux-1', `/social-cinema/title/${id}`,
        `/social-cinema/watch/${id}`, '/social-cinema/series/series-slug', '/social-cinema/pass',
        '/oauth/consent?authorization_id=abcdefgh', '/social/team/invite/abc.def', '/social/review/abc.def'];
    for (const path of paths) {
        assert.notEqual(mapAppLink(`https://veyrnox.ai${path}`), '/', path);
        const pathname = path.split('?')[0];
        assert.ok(APP_LINK_PATHS.some(p => p.endsWith('*') ? pathname.startsWith(p.slice(0, -1)) : pathname === p), `AASA: ${path}`);
        assert.ok(config.expo.android.intentFilters.some(filter => filter.autoVerify && filter.data.some(d =>
            d.scheme === 'https' && d.host === 'veyrnox.ai' && pathname.startsWith(d.pathPrefix))), `Android: ${path}`);
    }
});
