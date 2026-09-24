/**
 * Cloudflare Access as the front door for the two machine admin endpoints.
 *
 * /app/admin and /api/v1/admin/metrics are covered by an Access application
 * already. /api/admin/reap-assets and /api/admin/top-up-backfill are not,
 * because a cron caller cannot complete an identity login — so their only
 * control was a shared secret and a per-isolate throttle (audit 2026-09-23).
 *
 * Access can gate a machine: a service token policy issues a client id and
 * secret, the edge exchanges them for a signed assertion, and this verifies
 * that assertion in the Worker. Verifying it here rather than trusting the
 * dashboard means a policy that is ever loosened does not silently open the
 * endpoint: the code still refuses.
 *
 * Two headers decide who is who:
 *   - `cf-ray` is set by the edge on every request that reached it from the
 *     internet, and a client cannot suppress it. Its presence means external.
 *   - `cf-access-jwt-assertion` is the signed proof Access adds once a policy
 *     has been satisfied.
 * The Worker cron calls these routes through the app's own fetch handler
 * (lib/scheduledBackfill.js), which never crosses the edge and so carries
 * neither header. That request is internal and keeps its bearer-token check.
 */

import { fetchWithTimeout } from './fetchWithTimeout.js';

const CERTS_TIMEOUT_MS = 5000;
const CERTS_TTL_MS = 60 * 60 * 1000;
// Same reasoning as the Supabase JWKS ceiling: a cached key set stands in for
// a fetch we could not make, but not forever.
const CERTS_MAX_STALE_MS = 6 * 60 * 60 * 1000;
export const CLOCK_SKEW_SEC = 5;

let certsCache = null; // { fetchedAt, teamDomain, byKid: Map<string, CryptoKey> }

const b64urlToBytes = (s) => {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const jsonPart = (part) => JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));

function fail(reason) {
    const e = new Error(reason);
    e.reason = reason;
    return e;
}

/** Access publishes its signing keys per team domain. RS256 only. */
async function loadCerts(teamDomain) {
    const now = Date.now();
    if (certsCache && certsCache.teamDomain === teamDomain && now - certsCache.fetchedAt < CERTS_TTL_MS) {
        return certsCache.byKid;
    }
    const stale = () => {
        if (certsCache && certsCache.teamDomain === teamDomain && Date.now() - certsCache.fetchedAt < CERTS_MAX_STALE_MS) {
            return certsCache.byKid;
        }
        throw fail('certs');
    };

    let res;
    try {
        res = await fetchWithTimeout(
            new URL('/cdn-cgi/access/certs', `https://${teamDomain}`), {}, CERTS_TIMEOUT_MS);
    } catch {
        return stale();
    }
    if (!res.ok) return stale();

    let body;
    try { body = await res.json(); } catch { return stale(); }

    const byKid = new Map();
    for (const jwk of (body && body.keys) || []) {
        if (jwk.kty !== 'RSA' || !jwk.kid) continue;
        try {
            byKid.set(jwk.kid, await crypto.subtle.importKey(
                'jwk',
                { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
                { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
                false,
                ['verify'],
            ));
        } catch {
            // skip unusable
        }
    }
    if (byKid.size === 0) return stale();
    certsCache = { fetchedAt: now, teamDomain, byKid };
    return byKid;
}

/**
 * Verify an Access assertion. Throws with `.reason` on any failure; the
 * caller answers 401 and never repeats the reason to the client.
 * @returns {Promise<object>} the payload
 */
export async function verifyAccessJwt(token, { teamDomain, aud, now = Date.now() }) {
    if (typeof token !== 'string') throw fail('malformed');
    const parts = token.split('.');
    if (parts.length !== 3) throw fail('malformed');

    let header;
    try { header = jsonPart(parts[0]); } catch { throw fail('malformed'); }
    if (header.alg !== 'RS256' || !header.kid) throw fail('alg');

    const key = (await loadCerts(teamDomain)).get(header.kid);
    if (!key) throw fail('kid');

    const ok = await crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' },
        key,
        b64urlToBytes(parts[2]),
        new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) throw fail('signature');

    let payload;
    try { payload = jsonPart(parts[1]); } catch { throw fail('malformed'); }

    const seconds = Math.floor(now / 1000);
    if (payload.iss !== `https://${teamDomain}`) throw fail('issuer');
    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud || !auds.includes(aud)) throw fail('audience');
    if (!Number.isFinite(payload.exp) || payload.exp + CLOCK_SKEW_SEC < seconds) throw fail('expired');
    if (Number.isFinite(payload.nbf) && payload.nbf - CLOCK_SKEW_SEC > seconds) throw fail('not_yet_valid');

    return payload;
}

/**
 * The gate the two machine endpoints call first.
 *
 * - Internal (no `cf-ray`): allowed — the Worker cron's own invocation, which
 *   still has to present the endpoint's bearer token.
 * - External, Access configured: a valid assertion or nothing.
 * - External, Access NOT configured (no ACCESS_TEAM_DOMAIN / ACCESS_AUD):
 *   allowed, and logged every time, so the gap is visible until the Access
 *   application and its service token exist.
 *
 * @returns {Promise<{ok: true, via: 'internal'|'access'|'unconfigured'}|{ok: false}>}
 */
export async function requireAccess(req, env = process.env) {
    if (!req.headers.get('cf-ray')) return { ok: true, via: 'internal' };

    const teamDomain = env.ACCESS_TEAM_DOMAIN;
    const aud = env.ACCESS_AUD;
    if (!teamDomain || !aud) {
        console.error('[access] ACCESS_TEAM_DOMAIN/ACCESS_AUD unset; this endpoint is reachable from the internet behind its shared secret alone');
        return { ok: true, via: 'unconfigured' };
    }

    const assertion = req.headers.get('cf-access-jwt-assertion');
    if (!assertion) {
        console.error('[access] refused: no assertion on an external request');
        return { ok: false };
    }
    try {
        const payload = await verifyAccessJwt(assertion, { teamDomain, aud });
        return { ok: true, via: 'access', subject: payload.common_name || payload.sub };
    } catch (err) {
        console.error('[access] refused:', (err && err.reason) || 'invalid');
        return { ok: false };
    }
}

/** Tests only. */
export function _resetCertsCache() { certsCache = null; }
