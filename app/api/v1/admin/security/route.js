/**
 * GET /api/v1/admin/security?status=<state>&limit=<n> — security alerts
 * (ADR-0104): open alerts by severity, the alert list, and the latest raw
 * security events. Read through admin_security_alerts.
 *
 * POST /api/v1/admin/security { alert_id, status, note? } — move an alert
 * through triage. Every change lands in the append-only
 * security_alert_actions trail with the admin's email as actor.
 *
 * Same four gates as /api/v1/admin/metrics (lib/adminGate.js).
 */

import { NextResponse } from 'next/server';
import { rpc } from '../../../../../packages/db/supabase-client.js';
import { adminGate, rpcFailure, rpcRefusal, readJsonObject, UUID_RE, NO_STORE } from '../../../../../lib/adminGate.js';

const WHERE = 'api/v1/admin/security';
const STATUSES = new Set(['open', 'acknowledged', 'investigating', 'resolved', 'false_positive']);
const MAX_NOTE = 500;

export async function GET(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    if (status !== null && !STATUSES.has(status)) return NextResponse.json({ error: 'status_invalid' }, { status: 400 });
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw === null ? 50 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return NextResponse.json({ error: 'limit_invalid' }, { status: 400 });
    let result;
    try {
        result = await rpc('admin_security_alerts', { p_auth_id: g.authId, p_status: status, p_limit: limit }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'security_unavailable');
    return NextResponse.json({
        alerts: Array.isArray(result.alerts) ? result.alerts : [],
        open_by_severity: result.open_by_severity && typeof result.open_by_severity === 'object' ? result.open_by_severity : {},
        recent_events: Array.isArray(result.recent_events) ? result.recent_events : [],
    }, { headers: NO_STORE });
}

export async function POST(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const parsed = await readJsonObject(req);
    if (parsed.response) return parsed.response;
    const { alert_id: alertId, status, note } = parsed.body;
    if (typeof alertId !== 'string' || !UUID_RE.test(alertId)) return NextResponse.json({ error: 'alert_id_invalid' }, { status: 400 });
    if (typeof status !== 'string' || !STATUSES.has(status)) return NextResponse.json({ error: 'status_invalid' }, { status: 400 });
    if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE)) return NextResponse.json({ error: 'note_invalid' }, { status: 400 });
    let result;
    try {
        result = await rpc('admin_security_alert_set_status', { p_auth_id: g.authId, p_alert_id: alertId, p_status: status, p_note: note ?? null }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'alert_update_failed', ['alert_not_found']);
    return NextResponse.json({ status: result.status, unchanged: result.unchanged === true }, { headers: NO_STORE });
}
