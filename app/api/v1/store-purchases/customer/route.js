/**
 * GET /api/v1/store-purchases/customer — the RevenueCat customer id this account's app must use (ADR-0108).
 *
 * The id is a random UUID, stable per account, that only this signed-in caller is told. The app passes it to
 * RevenueCat as the app user id, so a purchase event can only name an account whose secret the buyer holds
 * (RevenueCat's own ids are chosen by the client, which would let anyone buy under someone else's).
 *
 * Off (404) until STORE_BILLING_ENABLED is "true". Identity is the middleware-verified header only.
 */
import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../../packages/db/supabase-client.js';
import { storeBillingEnabled } from '../../../../../lib/storeBilling.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req) {
    if (!storeBillingEnabled()) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE });
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return NextResponse.json({ error: 'not_authenticated' }, { status: 401, headers: NO_STORE });

    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return NextResponse.json({ error: 'gateway_not_configured' }, { status: 503, headers: NO_STORE });

    try {
        const res = await rpc('get_or_create_store_customer', { p_auth_id: authId }, cfg);
        if (res && res.ok === true) return NextResponse.json({ rc_customer_id: res.rc_customer_id }, { headers: NO_STORE });
        if (res && res.code === 'USER_NOT_FOUND') return NextResponse.json({ error: 'user_not_provisioned' }, { status: 409, headers: NO_STORE });
    } catch (err) {
        console.error('[store-purchases] customer failed:', err && err.message);
    }
    return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 503, headers: NO_STORE });
}
