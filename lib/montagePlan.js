/**
 * Plan tokens for the video agent (ADR-0074 §2, docs/montage/SPEC.md §4).
 *
 * `POST /api/v1/montage/plan` shows the user a plan and a price and returns a
 * token. The token is the Approve ticket: stateless HMAC, bound to the caller,
 * the exact brief and aspect, the price shown and an expiry. The generations
 * route accepts a video-agent job only with a valid token AND an idempotency
 * key equal to `plan_<nonce>`, so ledger_debit's UNIQUE (user_id, key) makes a
 * plan single-use with no new table: a second Approve is a replay, not a second
 * run. Web Crypto only (CLAUDE.md, bundler traps).
 */

export const PLAN_TTL_SECONDS = 30 * 60;
export const BRIEF_RE = /^[^\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]{3,500}$/;
export const ASPECTS = ['9:16', '16:9', '1:1'];

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
async function mac(secret, data) {
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** The idempotency key a plan's job must carry. */
export const planIdempotencyKey = (nonce) => `plan_${nonce}`;

/** @returns {Promise<{token:string, nonce:string, expiresAt:number}>} */
export async function mintPlanToken({ secret, authId, brief, aspect, credits, now = Math.floor(Date.now() / 1000) }) {
    const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
    const expiresAt = now + PLAN_TTL_SECONDS;
    const payload = b64url(enc.encode(JSON.stringify({ v: 1, u: authId, b: await sha256Hex(brief), a: aspect, c: credits, n: nonce, e: expiresAt })));
    return { token: `${payload}.${await mac(secret, payload)}`, nonce, expiresAt };
}

/**
 * @returns {Promise<{ok:true, nonce:string}|{ok:false, error:'plan_invalid'|'plan_expired'|'plan_mismatch'|'plan_price_changed'}>}
 */
export async function verifyPlanToken({ secret, token, authId, brief, aspect, credits, now = Math.floor(Date.now() / 1000) }) {
    if (!secret || typeof token !== 'string' || token.length > 600) return { ok: false, error: 'plan_invalid' };
    const [payload, sig, extra] = token.split('.');
    if (!payload || !sig || extra !== undefined) return { ok: false, error: 'plan_invalid' };
    const expected = await mac(secret, payload);
    if (sig.length !== expected.length) return { ok: false, error: 'plan_invalid' };
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) return { ok: false, error: 'plan_invalid' };
    let p;
    try { p = JSON.parse(new TextDecoder().decode(unb64url(payload))); } catch { return { ok: false, error: 'plan_invalid' }; }
    if (!p || p.v !== 1 || typeof p.n !== 'string' || !/^[A-Za-z0-9_-]{16,32}$/.test(p.n)) return { ok: false, error: 'plan_invalid' };
    if (!Number.isFinite(p.e) || now > p.e) return { ok: false, error: 'plan_expired' };
    if (p.u !== authId || p.b !== await sha256Hex(brief) || p.a !== aspect) return { ok: false, error: 'plan_mismatch' };
    if (p.c !== credits) return { ok: false, error: 'plan_price_changed' };
    return { ok: true, nonce: p.n };
}

/** Runner plan reduced to what the browser may see: no paths, no provider names. */
export function publicPlan(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const seconds = Number.isInteger(r.seconds) && r.seconds > 0 && r.seconds <= 120 ? r.seconds : null;
    const summary = typeof r.summary === 'string' ? r.summary.replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 300) : '';
    return { seconds, summary };
}
