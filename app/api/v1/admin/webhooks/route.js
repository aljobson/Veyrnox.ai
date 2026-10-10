/**
 * GET /api/v1/admin/webhooks?hours=<n>&limit=<n> — inbound webhook health
 * (ADR-0083): per-source counts by outcome for the window, the latest
 * refusals and failures with their typed error, and webhook_events rows
 * accepted but never marked processed. Read through admin_webhook_deliveries.
 *
 * Same four gates as /api/v1/admin/metrics (lib/adminGate.js).
 */

import { NextResponse } from 'next/server';
import { rpc } from '../../../../../packages/db/supabase-client.js';
import { adminGate, rpcFailure, rpcRefusal, NO_STORE } from '../../../../../lib/adminGate.js';

const WHERE = 'api/v1/admin/webhooks';

export async function GET(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const url = new URL(req.url);
    const hoursRaw = url.searchParams.get('hours');
    const hours = hoursRaw === null ? 24 : Number(hoursRaw);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) return NextResponse.json({ error: 'hours_invalid' }, { status: 400 });
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw === null ? 50 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return NextResponse.json({ error: 'limit_invalid' }, { status: 400 });
    let result;
    try {
        result = await rpc('admin_webhook_deliveries', { p_auth_id: g.authId, p_hours: hours, p_limit: limit }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'webhooks_unavailable');
    return NextResponse.json({
        since: result.since, hours: result.hours,
        by_source: Array.isArray(result.by_source) ? result.by_source : [],
        failures: Array.isArray(result.failures) ? result.failures : [],
        stuck_events: Array.isArray(result.stuck_events) ? result.stuck_events : [],
    }, { headers: NO_STORE });
}
