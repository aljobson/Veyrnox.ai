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
    assert.ok(APP_LINK_PATHS.every((p) => p.startsWith('/app/') || p === '/social/team/invite/*'));
    assert.ok(d.components.some((c) => c['/'] === '/social/team/invite/*'));
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
