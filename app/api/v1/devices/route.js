/**
 * Push-notification device tokens (ADR-0113). Bearer-only like the rest of
 * /api/v1: identity is the x-veyrnox-auth-id the middleware set. Off (404) until
 * PUSH_NOTIFICATIONS_ENABLED is "true".
 *
 * POST /api/v1/devices — register, rotate or change the opt-out. Idempotent:
 *   the same body again changes nothing.
 *   Body: { token, platform: "ios"|"android", device_id?, app_version?, notify_jobs? }
 *     token       Expo push token, e.g. "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
 *     device_id   stable per-install id (8-64 of A-Za-z0-9._-); a new token with
 *                 the same device_id replaces the old one
 *     app_version up to 32 of A-Za-z0-9._+-
 *     notify_jobs false turns generation alerts off for this device (default true)
 *   200: { registered: true, notify_jobs: boolean }
 *
 * DELETE /api/v1/devices — forget a token (sign-out, or notifications turned off).
 *   Body: { token }
 *   200: { removed: true } — also when the token was already gone or is not
 *   this account's, so the answer reveals nothing and a replay is a no-op.
 *
 * Errors: 400 body_invalid | token_invalid | platform_invalid | device_id_invalid |
 *   app_version_invalid | notify_jobs_invalid, 401 not_authenticated, 404 not_found
 *   (flag off) | account_not_found, 429 rate_limited (+ Retry-After), 502 push_unavailable,
 *   503 gateway_not_configured.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { pushEnabled, PUSH_TOKEN_RE } from '../../../../lib/pushNotifications.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_ID_RE = /^[A-Za-z0-9._-]{8,64}$/;
const APP_VERSION_RE = /^[A-Za-z0-9._+-]{1,32}$/;
const NO_STORE = { 'Cache-Control': 'no-store' };

const fail = (error, status, extra = {}, headers = {}) =>
    NextResponse.json({ error, ...extra }, { status, headers: { ...NO_STORE, ...headers } });

async function gate(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return { response: fail('not_authenticated', 401) };
    if (!pushEnabled()) return { response: fail('not_found', 404) };
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return { response: fail('gateway_not_configured', 503) };
    let body;
    try { body = await req.json(); } catch { return { response: fail('body_invalid', 400) }; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { response: fail('body_invalid', 400) };
    if (typeof body.token !== 'string' || !PUSH_TOKEN_RE.test(body.token)) return { response: fail('token_invalid', 400) };
    return { authId, cfg, body };
}

function refused(result) {
    const code = result?.error;
    if (code === 'rate_limited') {
        const retry = Number.isInteger(result.retry_after_seconds) ? Math.max(1, Math.min(3600, result.retry_after_seconds)) : 600;
        return fail('rate_limited', 429, { retry_after_seconds: retry }, { 'Retry-After': String(retry) });
    }
    if (code === 'account_not_found') return fail('account_not_found', 404);
    if (code === 'token_invalid' || code === 'platform_invalid') return fail(code, 400);
    console.error('[api/v1/devices] refused:', code);
    return fail('push_unavailable', 502);
}

export async function POST(req) {
    const g = await gate(req);
    if (g.response) return g.response;
    const { authId, cfg, body } = g;

    if (body.platform !== 'ios' && body.platform !== 'android') return fail('platform_invalid', 400);
    if (body.device_id != null && (typeof body.device_id !== 'string' || !DEVICE_ID_RE.test(body.device_id))) return fail('device_id_invalid', 400);
    if (body.app_version != null && (typeof body.app_version !== 'string' || !APP_VERSION_RE.test(body.app_version))) return fail('app_version_invalid', 400);
    if (body.notify_jobs != null && typeof body.notify_jobs !== 'boolean') return fail('notify_jobs_invalid', 400);

    let result;
    try {
        result = await rpc('register_push_token', {
            p_auth_id: authId, p_token: body.token, p_platform: body.platform,
            p_device_id: body.device_id ?? null, p_app_version: body.app_version ?? null,
            p_notify_jobs: body.notify_jobs ?? true,
        }, cfg);
    } catch (err) {
        console.error('[api/v1/devices] register failed:', err && err.message);
        return fail('push_unavailable', 502);
    }
    if (result?.ok !== true) return refused(result);
    return NextResponse.json({ registered: true, notify_jobs: result.notify_jobs === true }, { headers: NO_STORE });
}

export async function DELETE(req) {
    const g = await gate(req);
    if (g.response) return g.response;
    const { authId, cfg, body } = g;

    let result;
    try {
        result = await rpc('remove_push_token', { p_auth_id: authId, p_token: body.token }, cfg);
    } catch (err) {
        console.error('[api/v1/devices] remove failed:', err && err.message);
        return fail('push_unavailable', 502);
    }
    if (result?.ok !== true) return refused(result);
    return NextResponse.json({ removed: true }, { headers: NO_STORE });
}
