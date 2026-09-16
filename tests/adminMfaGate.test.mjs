// /api/v1/admin/metrics must refuse a session that has not satisfied a second
// factor once ADMIN_REQUIRE_AAL2 is on, and must not lock anybody out before
// then. Audit 2026-09-16, finding 4: an admin password is the highest-value
// credential in the product and the ledger is one read away from it.
//
// Also pins the middleware contract the gate rests on: `aal` is forwarded as
// x-veyrnox-auth-aal and any client-supplied copy is deleted first. A spoofable
// header would make the gate worse than useless.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Next resolves the extensionless `next/server` through its bundler; plain
// Node ESM needs the file name.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));

const route = new URL('../app/api/v1/admin/metrics/route.js', import.meta.url);
const middlewareSrc = readFileSync(new URL('../middleware.js', import.meta.url), 'utf8');

/** Call GET with a header bag and whatever ADMIN_REQUIRE_AAL2 says. */
async function get(headers, requireAal2) {
    const before = process.env.ADMIN_REQUIRE_AAL2;
    if (requireAal2 === undefined) delete process.env.ADMIN_REQUIRE_AAL2;
    else process.env.ADMIN_REQUIRE_AAL2 = requireAal2;
    // Fresh module each time: the route reads process.env per request, but the
    // import cache would otherwise share state across cases.
    const { GET } = await import(`${route.href}?t=${Math.random()}`);
    try {
        return await GET({ headers: { get: (k) => headers[k.toLowerCase()] ?? null } });
    } finally {
        if (before === undefined) delete process.env.ADMIN_REQUIRE_AAL2;
        else process.env.ADMIN_REQUIRE_AAL2 = before;
    }
}

const AUTHED = { 'x-veyrnox-auth-id': 'auth-123' };

test('an aal1 session is refused with mfa_required when the gate is on', async () => {
    const res = await get({ ...AUTHED, 'x-veyrnox-auth-aal': 'aal1' }, 'true');
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'mfa_required' });
});

test('a missing aal header is refused too — absent is not a pass', async () => {
    const res = await get(AUTHED, 'true');
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: 'mfa_required' });
});

test('the gate runs before anything reaches Supabase', async () => {
    // No SUPABASE_URL configured here, so a 503 would mean the gate was skipped.
    const before = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    try {
        const res = await get({ ...AUTHED, 'x-veyrnox-auth-aal': 'aal1' }, 'true');
        assert.equal(res.status, 403);
    } finally {
        if (before !== undefined) process.env.SUPABASE_URL = before;
    }
});

test('an unauthenticated caller still gets 401, not a hint about MFA', async () => {
    const res = await get({}, 'true');
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'not_authenticated' });
});

test('with the gate off, an aal1 session passes the gate and moves on', async () => {
    // Not configured for Supabase, so reaching 503 proves the gate let it by.
    const before = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    try {
        for (const flag of ['false', undefined]) {
            const res = await get({ ...AUTHED, 'x-veyrnox-auth-aal': 'aal1' }, flag);
            assert.equal(res.status, 503, `ADMIN_REQUIRE_AAL2=${flag} blocked the request`);
        }
    } finally {
        if (before !== undefined) process.env.SUPABASE_URL = before;
    }
});

test('only the literal "true" arms the gate', async () => {
    const before = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    try {
        for (const flag of ['1', 'TRUE', 'yes', '']) {
            const res = await get({ ...AUTHED, 'x-veyrnox-auth-aal': 'aal1' }, flag);
            assert.equal(res.status, 503, `${JSON.stringify(flag)} armed the gate`);
        }
    } finally {
        if (before !== undefined) process.env.SUPABASE_URL = before;
    }
});

test('middleware strips an inbound aal header before forwarding its own', () => {
    // IDENTITY_HEADERS is deleted from the inbound copy on every branch, the
    // deprecated 410 passthrough included.
    const list = middlewareSrc.slice(
        middlewareSrc.indexOf('const IDENTITY_HEADERS'),
        middlewareSrc.indexOf('];', middlewareSrc.indexOf('const IDENTITY_HEADERS')),
    );
    assert.ok(list.includes("'x-veyrnox-auth-aal'"), 'aal is not in IDENTITY_HEADERS — a client could spoof it');
    assert.match(middlewareSrc, /for \(const h of IDENTITY_HEADERS\) headers\.delete\(h\);/);
    assert.match(middlewareSrc, /headers\.set\('x-veyrnox-auth-aal', String\(claims\.aal\)\)/);
});
