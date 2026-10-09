/**
 * Cloudflare Access as the front door for the admin endpoints.
 *
 * One Access application covers /app/admin, /api/v1/admin/* and /api/admin/*
 * on the site's own hostname. The edge applies it by path. Verifying the
 * assertion here as well means the check travels with the route: a policy
 * that is ever loosened, or a request that reaches the Worker by a path or
 * hostname the rule does not name, does not open the endpoint. The code still
 * refuses.
 *
 * Two kinds of caller:
 *   - The machine endpoints (/api/admin/reap-assets, /api/admin/top-up-backfill)
 *     call requireAccess. A cron caller cannot complete an identity login, so a
 *     service token policy issues a client id and secret and the edge exchanges
 *     them for a signed assertion (audit 2026-09-23).
 *   - The dashboard routes (/api/v1/admin/*) call requireDashboardAccess, after
 *     middleware.js has verified the Supabase token (ADR-0078). They take the
 *     assertion of a person who logged in, not one issued to a service token.
 *     The Cinema administrator routes under the same prefix apply that rule
 *     from their own handlers, with verifyAccessLogin.
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
// A `kid` the cached set does not hold triggers one more fetch of the set, at
// most once per this window per isolate, so a key Access rotated in is picked
// up by the first request that carries it and a stream of junk tokens cannot
// become a fetch per request. The window is taken before the fetch, whether
// or not it then succeeds: a miss that arrives while it is in flight, or
// within the window after one that failed, is refused and passes on retry.
export const CERTS_MISS_REFRESH_MS = 60 * 1000;
export const CLOCK_SKEW_SEC = 5;

let certsCache = null; // { fetchedAt, teamDomain, byKid: Map<string, CryptoKey> }
let lastMissRefreshAt = 0;

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
async function loadCerts(teamDomain, { force = false } = {}) {
    const now = Date.now();
    if (!force && certsCache && certsCache.teamDomain === teamDomain && now - certsCache.fetchedAt < CERTS_TTL_MS) {
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

    let key = (await loadCerts(teamDomain)).get(header.kid);
    if (!key) {
        // The held set is replaced only by a fetch that succeeds, so a failed
        // refetch changes nothing and the answer stays 'kid'.
        const at = Date.now();
        if (at - lastMissRefreshAt >= CERTS_MISS_REFRESH_MS) {
            lastMissRefreshAt = at;
            key = (await loadCerts(teamDomain, { force: true })).get(header.kid);
        }
        if (!key) throw fail('kid');
    }

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

/**
 * Whether Access issued this assertion to a person who logged in. Its
 * application token reference gives two payloads: a login carries `email` and
 * the user's id in `sub`; a service token carries its client id in
 * `common_name`, an empty `sub` and no `email`. One application and one
 * audience cover the machine endpoints and the dashboard, so both kinds
 * verify for either. `common_name` is not read: a policy may also ask a
 * person for a client certificate, and the reference does not say that a
 * login then carries none.
 */
function isLogin(payload) {
    const text = (v) => typeof v === 'string' && v !== '';
    return text(payload.email) && text(payload.sub);
}

/**
 * verifyAccessJwt, for a route that is for a person: any other validly signed
 * assertion throws as well, with `.reason` 'not_a_login'.
 * @returns {Promise<object>} the payload
 */
export async function verifyAccessLogin(token, options) {
    const payload = await verifyAccessJwt(token, options);
    if (!isLogin(payload)) throw fail('not_a_login');
    return payload;
}

/**
 * The gate the admin dashboard routes call, on top of the verified Supabase
 * identity and the second factor (ADR-0078).
 *
 * Stricter than requireAccess, because nothing here is the Worker calling
 * itself and there is no shared secret behind the door:
 * - Access configured (every deployed Worker): a valid assertion of a
 *   person's login or nothing. A missing `cf-ray` earns no exemption, and
 *   neither does an assertion issued to a service token.
 * - Access not configured: only a request that did not come through the edge
 *   passes, which is local development and unit tests. One that did is refused.
 *
 * @returns {Promise<{ok: true, via: 'access'|'local', subject?: string}
 *   | {ok: false, status: 403|503, error: 'access_required'|'access_not_configured'}>}
 */
export async function requireDashboardAccess(req, env = process.env) {
    const teamDomain = env.ACCESS_TEAM_DOMAIN;
    const aud = env.ACCESS_AUD;
    if (!teamDomain || !aud) {
        if (!req.headers.get('cf-ray')) return { ok: true, via: 'local' };
        console.error('[access] refused: ACCESS_TEAM_DOMAIN/ACCESS_AUD unset on an admin dashboard route');
        return { ok: false, status: 503, error: 'access_not_configured' };
    }

    const assertion = req.headers.get('cf-access-jwt-assertion');
    if (!assertion) {
        console.error('[access] refused: no assertion on an admin dashboard request');
        return { ok: false, status: 403, error: 'access_required' };
    }
    try {
        const payload = await verifyAccessLogin(assertion, { teamDomain, aud });
        return { ok: true, via: 'access', subject: payload.sub };
    } catch (err) {
        console.error('[access] refused:', (err && err.reason) || 'invalid');
        return { ok: false, status: 403, error: 'access_required' };
    }
}

/** Tests only. */
export function _resetCertsCache() { certsCache = null; lastMissRefreshAt = 0; }
