#!/usr/bin/env node
// Signed-in smoke test for the live site, run by deploy-production after a
// deploy has passed the public check-site-health.mjs. That check proves pages
// render and the gateway answers 401; it cannot prove a signed-in request
// still works end to end (middleware JWT verification, identity headers, a
// database read), which is what a bad release breaks first.
//
// Sign-in on the live site is behind Turnstile, so a script cannot use the
// password grant. Instead the service-role key asks Supabase Auth for a
// one-time magic-link token for ONE dedicated test user, and the anon-key
// verify endpoint turns it into a session. The service-role key is used for
// that single Auth call and never sent to veyrnox.ai. After the session
// exists, only read-only GET requests are made, then the session is revoked.
//
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
//      SMOKE_USER_EMAIL, optional SMOKE_BASE_URL (default https://veyrnox.ai).
// Exit 0 healthy, 1 a check failed, 2 no session could be obtained.
// Nothing sensitive is printed: no tokens, no keys, no email address.
import { fileURLToPath } from 'node:url';

export const DEFAULT_BASE_URL = 'https://veyrnox.ai';
const ATTEMPTS = 3;
const RETRY_DELAY_MS = Number(process.env.SMOKE_RETRY_DELAY_MS) || 5_000;
const TIMEOUT_MS = 20_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SessionError extends Error {}

export function assessSessionMe(status, body, email) {
    const problems = [];
    if (status !== 200) problems.push(`status ${status}, expected 200`);
    if (status === 200) {
        if (!UUID_RE.test(String(body?.authId ?? ''))) problems.push('authId is not a UUID');
        if (String(body?.email ?? '').toLowerCase() !== String(email).toLowerCase()) {
            problems.push('email does not match the smoke user');
        }
    }
    return problems;
}

export function assessBalance(status, body) {
    const problems = [];
    if (status !== 200) problems.push(`status ${status}, expected 200`);
    if (status === 200) {
        for (const key of ['balance', 'free_credits']) {
            if (typeof body?.[key] !== 'number' || !Number.isFinite(body[key]) || body[key] < 0) {
                problems.push(`${key} is not a non-negative number`);
            }
        }
    }
    return problems;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(fetchImpl, url, options) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
    let body = null;
    try { body = await response.json(); } catch { /* an empty or non-JSON body stays null */ }
    return { status: response.status, body };
}

// One magic-link token for the smoke user, exchanged for a session. Returns
// the access token. Throws SessionError for anything that stops us getting one.
export async function openSession({ supabaseUrl, anonKey, serviceRoleKey, email }, fetchImpl = fetch) {
    const link = await request(fetchImpl, `${supabaseUrl}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'magiclink', email }),
    });
    const tokenHash = link.body?.hashed_token ?? link.body?.properties?.hashed_token;
    if (link.status !== 200 || typeof tokenHash !== 'string' || !tokenHash) {
        throw new SessionError(`generate_link answered ${link.status} with no token (does the smoke user exist?)`);
    }
    const verified = await request(fetchImpl, `${supabaseUrl}/auth/v1/verify`, {
        method: 'POST',
        headers: { apikey: anonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
    });
    const accessToken = verified.body?.access_token;
    if (verified.status !== 200 || typeof accessToken !== 'string' || !accessToken) {
        throw new SessionError(`verify answered ${verified.status} with no session`);
    }
    return accessToken;
}

async function closeSession({ supabaseUrl, anonKey }, accessToken, fetchImpl) {
    try {
        await request(fetchImpl, `${supabaseUrl}/auth/v1/logout?scope=local`, {
            method: 'POST',
            headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` },
        });
    } catch { /* best effort: the token expires on its own */ }
}

async function getJson(fetchImpl, baseUrl, path, accessToken) {
    return request(fetchImpl, new URL(path, baseUrl), {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
}

// Returns { ok, results: [{ name, problems }] }. Throws SessionError when no
// session could be opened.
export async function runAuthedSmoke(config, fetchImpl = fetch) {
    const accessToken = await openSession(config, fetchImpl);
    try {
        const me = await getJson(fetchImpl, config.baseUrl, '/api/v1/session/me', accessToken);
        const balance = await getJson(fetchImpl, config.baseUrl, '/api/v1/balance', accessToken);
        const results = [
            { name: '/api/v1/session/me', problems: assessSessionMe(me.status, me.body, config.email) },
            { name: '/api/v1/balance', problems: assessBalance(balance.status, balance.body) },
        ];
        return { ok: results.every(r => r.problems.length === 0), results };
    } finally {
        await closeSession(config, accessToken, fetchImpl);
    }
}

export function readConfig(env) {
    const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'SMOKE_USER_EMAIL']
        .filter(name => !env[name]);
    if (missing.length > 0) throw new SessionError(`missing ${missing.join(', ')}`);
    return {
        supabaseUrl: env.SUPABASE_URL.replace(/\/+$/, ''),
        anonKey: env.SUPABASE_ANON_KEY,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
        email: env.SMOKE_USER_EMAIL,
        baseUrl: env.SMOKE_BASE_URL || DEFAULT_BASE_URL,
    };
}

async function main() {
    let config;
    try { config = readConfig(process.env); } catch (err) {
        console.error(`authed smoke: ${err.message}`);
        process.exit(2);
    }
    let last;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        try {
            const { ok, results } = await runAuthedSmoke(config);
            for (const r of results) {
                console.log(`${r.problems.length === 0 ? 'ok  ' : 'FAIL'} ${r.name}${r.problems.length ? ` - ${r.problems.join('; ')}` : ''}`);
            }
            if (ok) process.exit(0);
            last = 1;
        } catch (err) {
            console.error(`attempt ${attempt}: ${err instanceof SessionError ? err.message : `request failed (${err.name})`}`);
            last = 2;
        }
        if (attempt < ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
    console.error(last === 2
        ? 'authed smoke: could not open a session as the smoke user'
        : 'authed smoke: a signed-in check failed');
    process.exit(last);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
