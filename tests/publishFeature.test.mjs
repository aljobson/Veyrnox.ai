import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { isPublishApiPath, publishEnabled } from '../lib/social/publishFeature.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next){ return next(s==='next/server'?'next/server.js':s,c); }`));
const { NextRequest } = await import('next/server.js');
const { middleware } = await import('../middleware.js');

// Veyrnox Publish remains controlled by PUBLISH_ENABLED, which
// must be exactly "true" before the page, the menu link or any
// /api/v1/social route answers.

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

async function withEnv(vars, run) {
    const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    try { return await run(); } finally {
        for (const [k, v] of Object.entries(before)) {
            if (v === undefined) delete process.env[k]; else process.env[k] = v;
        }
    }
}

test('only the exact string "true" opens Publish', () => {
    assert.equal(publishEnabled({ PUBLISH_ENABLED: 'true' }), true);
    for (const v of [undefined, '', 'false', '1', 'TRUE', 'yes']) {
        assert.equal(publishEnabled({ PUBLISH_ENABLED: v }), false, String(v));
    }
});

test('the gate covers /api/v1/social and nothing else', () => {
    for (const p of ['/api/v1/social', '/api/v1/social/accounts', '/api/v1/social/posts', '/api/v1/social/accounts/tiktok/callback']) {
        assert.equal(isPublishApiPath(p), true, p);
    }
    for (const p of ['/api/v1/socialite', '/api/v1/account', '/app/publish', '/media/social/abc']) {
        assert.equal(isPublishApiPath(p), false, p);
    }
});

test('with Publish off, every social route answers publish_not_open before any auth work', async () => {
    await withEnv({ SUPABASE_URL: 'https://example.supabase.co', PUBLISH_ENABLED: 'false' }, async () => {
        for (const path of ['/api/v1/social/accounts', '/api/v1/social/posts', '/api/v1/social/accounts/youtube/connect']) {
            const res = await middleware(new NextRequest(`https://example.test${path}`, { method: 'POST' }));
            assert.equal(res.status, 503, path);
            assert.deepEqual(await res.json().then((b) => b.error), 'publish_not_open');
            assert.equal(res.headers.get('x-middleware-next'), null, 'never reaches the handler');
        }
        // Other API routes are untouched: still a 401 without a token.
        const other = await middleware(new NextRequest('https://example.test/api/v1/account'));
        assert.equal(other.status, 401);
    });
});

test('with Publish on, social routes go through the normal token check', async () => {
    await withEnv({ SUPABASE_URL: 'https://example.supabase.co', PUBLISH_ENABLED: 'true' }, async () => {
        const res = await middleware(new NextRequest('https://example.test/api/v1/social/accounts'));
        assert.equal(res.status, 401);
    });
});

test('the page, the OAuth landing and the menu link are gated on the same switch', () => {
    for (const p of ['app/veyrnox/app/publish/layout.js', 'app/social/connect/callback/[network]/layout.js']) {
        const src = read(p);
        assert.match(src, /if \(!publishEnabled\(\)\) notFound\(\);/, p);
    }
    assert.match(read('app/veyrnox/layout.js'), /<PublishFlagProvider enabled=\{publishEnabled\(\)\}>/);
    const nav = read('app/veyrnox/_components/NavAuthButtons.js');
    assert.match(nav, /usePublishEnabled\(\)/);
    assert.match(nav, /\{links\.map\(/);
});

test('production activates only the YouTube release; staging remains enabled', () => {
    const wrangler = read('wrangler.jsonc');
    const [prod, staging] = wrangler.split('"env": {');
    assert.match(prod, /"PUBLISH_ENABLED": "true"/);
    assert.match(prod, /"PUBLISH_RELEASED_NETWORKS": "youtube"/);
    assert.match(prod, /"PUBLISH_ANALYTICS_ENABLED": "true"/);
    for (const flag of ['PUBLISH_UPLOADS_ENABLED', 'PUBLISH_POSTING_INSIGHTS_ENABLED', 'PUBLISH_EXTENDED_NETWORKS_ENABLED', 'INSTAGRAM_INSIGHTS_SCOPE_ENABLED', 'TIKTOK_ANALYTICS_SCOPE_ENABLED']) {
        assert.match(prod, new RegExp(`"${flag}": "false"`), flag);
    }
    assert.match(staging, /"PUBLISH_ENABLED": "true"/);
});

test('every OAuth callback turns the Free-tier refusal into a typed 409', () => {
    for (const n of ['instagram', 'linkedin', 'twitter', 'tiktok', 'youtube']) {
        const src = read(`app/api/v1/social/accounts/${n}/callback/route.js`);
        assert.match(src, /recorded\.code === 'ACCOUNT_LIMIT'/, n);
        assert.match(src, /\{ ok: false, code: 'ACCOUNT_LIMIT' \}, \{ status: 409 \}/, n);
    }
    assert.match(read('app/social/connect/callback/[network]/page.js'), /ACCOUNT_LIMIT:/);
});
