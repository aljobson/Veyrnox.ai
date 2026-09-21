/**
 * Pins the response security policy so it cannot be weakened by accident.
 *
 * The CSP is the one control that is a deliberate, documented compromise
 * (script-src keeps 'unsafe-inline' for Next's un-nonced inline RSC scripts on
 * statically prerendered pages — see next.config.mjs). Everything around it is
 * therefore load-bearing, and CLAUDE.md requires an ADR to widen connect-src or
 * lower HSTS. This test is what makes that reviewable instead of aspirational:
 * if you are here because it failed, the change needs an ADR, not a new value.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import nextConfig from '../next.config.mjs';

const SUPABASE_HOST = 'https://xdxdzmsztyzbnzeforxx.supabase.co';
const TURNSTILE_HOST = 'https://challenges.cloudflare.com';
const MIN_HSTS_AGE = 63072000;

async function headerMap() {
    const groups = await nextConfig.headers();
    assert.equal(groups.length, 1, 'expected one header group covering every path');
    assert.equal(groups[0].source, '/:path*');
    return new Map(groups[0].headers.map((h) => [h.key.toLowerCase(), h.value]));
}

function directives(csp) {
    return new Map(csp.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name, values];
    }));
}

test('the CSP keeps every directive the threat model relies on', async () => {
    const csp = (await headerMap()).get('content-security-policy');
    assert.ok(csp, 'Content-Security-Policy header is missing');
    const d = directives(csp);

    assert.deepEqual(d.get('default-src'), ["'self'"]);
    assert.deepEqual(d.get('frame-ancestors'), ["'none'"]);
    assert.deepEqual(d.get('object-src'), ["'none'"]);
    assert.deepEqual(d.get('base-uri'), ["'self'"]);
    assert.deepEqual(d.get('form-action'), ["'self'"]);
});

test("no 'unsafe-eval' outside next dev, and no wildcard script source", async () => {
    // NODE_ENV is not 'development' under the test runner, so this is the
    // policy production ships. 'unsafe-eval' was dropped deliberately.
    const csp = (await headerMap()).get('content-security-policy');
    const scriptSrc = directives(csp).get('script-src');
    assert.ok(scriptSrc, 'script-src is missing');
    assert.ok(!scriptSrc.includes("'unsafe-eval'"), "production script-src must not allow 'unsafe-eval'");
    // Turnstile is the one remote script origin, admitted by ADR-0026. Any
    // other remote origin needs its own ADR before this list changes.
    const remote = scriptSrc.filter((s) => s === '*' || s.startsWith('http'));
    assert.deepEqual(remote, [TURNSTILE_HOST],
        `script-src may name only Turnstile as a remote origin: ${scriptSrc.join(' ')}`);
});

test('frame-src admits Turnstile and nothing else', async () => {
    // Without frame-src, frames fall back to default-src 'self' and the
    // widget's challenge iframe is blocked. With it, it must stay this narrow.
    const csp = (await headerMap()).get('content-security-policy');
    assert.deepEqual(directives(csp).get('frame-src'), [TURNSTILE_HOST]);
});

test('connect-src reaches our own origin and the Supabase project only', async () => {
    // Widening this is how an exfiltration path or a new vendor arrives.
    // CLAUDE.md: "Adding a host means an ADR."
    const csp = (await headerMap()).get('content-security-policy');
    assert.deepEqual(directives(csp).get('connect-src'), ["'self'", SUPABASE_HOST]);
});

test('HSTS is preload-eligible and never lowered', async () => {
    const hsts = (await headerMap()).get('strict-transport-security');
    assert.ok(hsts, 'Strict-Transport-Security header is missing');
    const age = Number(/max-age=(\d+)/.exec(hsts)?.[1]);
    assert.ok(age >= MIN_HSTS_AGE, `max-age ${age} is below the required ${MIN_HSTS_AGE}`);
    assert.match(hsts, /includeSubDomains/);
    assert.match(hsts, /preload/);
});

test('the remaining hardening headers are all present', async () => {
    const h = await headerMap();
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.match(h.get('permissions-policy') ?? '', /camera=\(\)/);
});

test('the anon key in env is a publishable key, not a service-role key', async () => {
    // A service-role key pasted here would bypass RLS from the browser.
    const { NEXT_PUBLIC_SUPABASE_ANON_KEY: anon } = nextConfig.env;
    assert.ok(anon, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is missing');
    assert.ok(anon.startsWith('sb_publishable_'), 'only a publishable key may be exposed to the client');
    for (const bad of ['service_role', 'sb_secret_']) {
        assert.ok(!anon.includes(bad), `client key must not contain ${bad}`);
    }
});
