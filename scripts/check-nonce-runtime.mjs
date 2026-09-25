#!/usr/bin/env node
// Production-build probe; start the isolated Workers preview before running.
import assert from 'node:assert/strict';
const origin = process.env.CSP_PROBE_ORIGIN || 'http://127.0.0.1:8795';
const seen = new Set();
for (const path of ['/app', '/app/credits', '/app/account', '/app/create', '/app/library', '/auth/callback', '/app/not-a-page']) {
    for (let n = 0; n < 2; n++) {
        const started = performance.now();
        const response = await fetch(new URL(path, origin), {
            headers: { 'x-nonce': 'inbound-forgery', 'content-security-policy': "script-src 'unsafe-inline'" },
            signal: AbortSignal.timeout(30000),
        });
        assert.equal(response.status, path === '/app/not-a-page' ? 404 : 200, path);
        const policy = response.headers.get('content-security-policy') || '';
        const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
        assert.ok(nonce, `${path}: no response nonce`);
        assert.ok(!seen.has(nonce), `${path}: reused nonce`);
        seen.add(nonce);
        assert.ok(!/script-src[^;]*unsafe-inline/.test(policy), `${path}: permissive script policy`);
        assert.match(response.headers.get('cache-control') || '', /no-store/, `${path}: shared cache`);
        const html = await response.text();
        let executableInline = 0;
        for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
            const [_, attrs, source] = match;
            if (/\bsrc\s*=/.test(attrs) || /type="application\/ld\+json"/.test(attrs) || !source.trim()) continue;
            executableInline++;
            assert.equal(/\bnonce="([^"]+)"/.exec(attrs)?.[1], nonce, `${path}: executable inline script lacks matching nonce`);
        }
        assert.ok(executableInline > 0, `${path}: did not inspect executable framework scripts`);
        console.log(`${path}: ${response.status}, ${executableInline} matching inline scripts, ${Math.round(performance.now() - started)}ms`);
    }
}
const publicPage = await fetch(new URL('/', origin), { signal: AbortSignal.timeout(30000) });
assert.equal(publicPage.status, 200);
assert.match(publicPage.headers.get('content-security-policy') || '', /script-src[^;]*unsafe-inline/);
console.log('Public-page fallback preserved; this probe does not prove whole-site CSP coverage or browser hydration.');
