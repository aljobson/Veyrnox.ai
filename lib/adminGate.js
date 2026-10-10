/**
 * The four gates every /api/v1/admin/* dashboard route answers in order, and
 * the two ways a Supabase RPC refusal is turned into a typed response.
 *
 *   1. middleware identity (x-veyrnox-auth-id, blank means absent)     -> 401
 *   2. the ADMIN_REQUIRE_AAL2 second-factor flag                        -> 403 mfa_required
 *   3. the Cloudflare Access assertion verified in code (ADR-0078)     -> 403 / 503
 *   4. Supabase configured                                             -> 503
 *
 * The RPC re-checks users.is_admin itself and raises 42501 'not_admin' for
 * anyone else, so the data is safe even if a route forgets a gate.
 */

import { NextResponse } from 'next/server';
import { envConfig, SupabaseError } from '../packages/db/supabase-client.js';
import { requireDashboardAccess } from './accessJwt.js';

const NOT_ADMIN = '42501';
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const IDEMPOTENCY_RE = /^[A-Za-z0-9._-]{8,128}$/;
export const NO_STORE = { 'Cache-Control': 'no-store' };

const requireAal2 = () => process.env.ADMIN_REQUIRE_AAL2 === 'true';

/** @returns {Promise<{ response: Response } | { authId: string, cfg: object }>} */
export async function adminGate(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return { response: NextResponse.json({ error: 'not_authenticated' }, { status: 401 }) };
    if (requireAal2() && req.headers.get('x-veyrnox-auth-aal') !== 'aal2') {
        return { response: NextResponse.json({ error: 'mfa_required' }, { status: 403 }) };
    }
    const access = await requireDashboardAccess(req);
    if (!access.ok) return { response: NextResponse.json({ error: access.error }, { status: access.status }) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) {
        return { response: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 }) };
    }
    return { authId, cfg };
}

/** A thrown RPC error: 403 for the RPC's own admin check, 502 for anything else. */
export function rpcFailure(err, where) {
    const body = err instanceof SupabaseError ? err.body : null;
    const code = body && (body.code || (body.error && body.error.code));
    if (code === NOT_ADMIN || JSON.stringify(body || '').includes('not_admin')) {
        return NextResponse.json({ error: 'not_admin' }, { status: 403 });
    }
    console.error(`[${where}] rpc failed:`, err && err.status, body);
    return NextResponse.json({ error: 'internal' }, { status: 502 });
}

/**
 * An RPC that answered { ok: false, code }: the code in kebab case, 404 for
 * the codes that mean "no such row", 400 otherwise.
 */
export function rpcRefusal(result, fallback, notFound = ['user_not_found', 'job_not_found']) {
    const code = result && result.code ? String(result.code).toLowerCase() : fallback;
    return NextResponse.json({ error: code }, { status: notFound.includes(code) ? 404 : 400 });
}

/** Parse a small JSON object body; null when it is not one. */
export async function readJsonObject(req, maxBytes = 4 * 1024) {
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) return { response: NextResponse.json({ error: 'body_too_large' }, { status: 413 }) };
    let body;
    try { body = await req.json(); } catch { return { response: NextResponse.json({ error: 'body_invalid' }, { status: 400 }) }; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { response: NextResponse.json({ error: 'body_invalid' }, { status: 400 }) };
    }
    return { body };
}

/** The Idempotency-Key header, or a 400 response. */
export function idempotencyKey(req) {
    const key = req.headers.get('idempotency-key');
    if (typeof key !== 'string' || !IDEMPOTENCY_RE.test(key)) {
        return { response: NextResponse.json({ error: 'idempotency_key_invalid' }, { status: 400 }) };
    }
    return { key };
}
