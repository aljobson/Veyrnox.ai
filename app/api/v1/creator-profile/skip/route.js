/**
 * POST /api/v1/creator-profile/skip — record that the person skipped the Vibe Check
 * (ADR-0251). Idempotent, and a skip never overwrites completed answers.
 * Same gate as ../route.js: 401 not_authenticated, 404 not_found (flag off).
 * 200: { status: "skipped" | "completed", changed: boolean }
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { creatorProfileEnabled } from '../../../../../lib/creatorProfile.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (error, status) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return fail('not_authenticated', 401);
    if (!creatorProfileEnabled()) return fail('not_found', 404);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return fail('gateway_not_configured', 503);

    let result;
    try {
        result = await rpc('skip_creator_profile', { p_auth_id: authId }, cfg);
    } catch (err) {
        console.error('[api/v1/creator-profile/skip] failed:', err && err.message);
        return fail('creator_profile_unavailable', 502);
    }
    if (result?.error === 'account_not_found') return fail('account_not_found', 404);
    if (result?.ok !== true) {
        console.error('[api/v1/creator-profile/skip] refused:', result?.error);
        return fail('creator_profile_unavailable', 502);
    }
    return NextResponse.json({ status: result.status, changed: result.changed === true }, { headers: NO_STORE });
}
