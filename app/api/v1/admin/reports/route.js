/**
 * /api/v1/admin/reports — the user report queue and evidence release
 * (ADR-0083).
 *
 *   GET  ?status=open|resolved|all&limit=<n>   reports, CSAM first, then oldest first
 *   POST { report_id, resolution }             resolve one with a note (idempotent)
 *   POST { release_action_id, reason }         release an evidence hold: the keys of
 *                                              a csam_escalation go to the reaper
 *
 * Same four gates as /api/v1/admin/metrics (lib/adminGate.js).
 */

import { NextResponse } from 'next/server';
import { rpc } from '../../../../../packages/db/supabase-client.js';
import { adminGate, rpcFailure, rpcRefusal, readJsonObject, UUID_RE, NO_STORE } from '../../../../../lib/adminGate.js';

const WHERE = 'api/v1/admin/reports';
const STATUSES = new Set(['open', 'resolved']);

export async function GET(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? 'open';
    if (status !== 'all' && !STATUSES.has(status)) return NextResponse.json({ error: 'status_invalid' }, { status: 400 });
    const limitRaw = url.searchParams.get('limit');
    const limit = limitRaw === null ? 50 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return NextResponse.json({ error: 'limit_invalid' }, { status: 400 });
    let result;
    try {
        result = await rpc('list_content_reports', { p_auth_id: g.authId, p_status: status === 'all' ? null : status, p_limit: limit }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'reports_unavailable');
    return NextResponse.json({ reports: Array.isArray(result.reports) ? result.reports : [], unavailable_scans_24h: result.unavailable_scans_24h ?? 0,
        asset_gone_scans_24h: result.asset_gone_scans_24h ?? 0 }, { headers: NO_STORE });
}

export async function POST(req) {
    const g = await adminGate(req);
    if (g.response) return g.response;
    const b = await readJsonObject(req);
    if (b.response) return b.response;
    const { report_id: reportId, resolution, release_action_id: releaseId, reason } = b.body;
    if ('release_job_id' in b.body || 'scanner_disarm' in b.body) return scannerAction(g, b.body);
    if (typeof releaseId === 'string') return release(g, releaseId, reason);
    if (typeof reportId !== 'string' || !UUID_RE.test(reportId)) return NextResponse.json({ error: 'report_id_invalid' }, { status: 400 });
    if (typeof resolution !== 'string' || resolution.trim().length < 3 || resolution.length > 500) return NextResponse.json({ error: 'resolution_invalid' }, { status: 400 });
    let result;
    try {
        result = await rpc('resolve_content_report', { p_auth_id: g.authId, p_report_id: reportId, p_resolution: resolution.trim() }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'resolve_rejected', ['report_not_found']);
    return NextResponse.json({ report_id: result.report_id, replayed: result.replayed === true }, { status: result.replayed === true ? 200 : 201, headers: NO_STORE });
}

async function release(g, actionId, reason) {
    if (!UUID_RE.test(actionId)) return NextResponse.json({ error: 'release_action_id_invalid' }, { status: 400 });
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 500) return NextResponse.json({ error: 'reason_invalid' }, { status: 400 });
    let result;
    try {
        result = await rpc('release_evidence_hold', { p_auth_id: g.authId, p_action_id: actionId, p_reason: reason.trim() }, g.cfg);
    } catch (err) {
        return rpcFailure(err, WHERE);
    }
    if (!result || result.ok !== true) return rpcRefusal(result, 'release_rejected', ['action_not_found']);
    console.error(`[${WHERE}] evidence released for action`, actionId, 'keys', result.released);
    return NextResponse.json({ released: result.released, action_id: result.action_id || null, replayed: result.replayed === true },
        { status: result.replayed === true ? 200 : 201, headers: NO_STORE });
}

async function scannerAction(g, body) {
    const disarm = body.scanner_disarm === true;
    if ('scanner_disarm' in body && (!disarm || 'release_job_id' in body)) return NextResponse.json({ error: 'body_invalid' }, { status: 400 });
    if (!disarm && (typeof body.release_job_id !== 'string' || !UUID_RE.test(body.release_job_id))) return NextResponse.json({ error: 'release_job_id_invalid' }, { status: 400 });
    if (typeof body.reason !== 'string' || body.reason.trim().length < 3 || body.reason.length > 500) return NextResponse.json({ error: 'reason_invalid' }, { status: 400 });
    let result;
    try {
        result = await rpc(disarm ? 'disarm_content_scan_monitor' : 'release_content_hold', {
            p_auth_id: g.authId, p_reason: body.reason.trim(), ...(disarm ? {} : { p_job_id: body.release_job_id }),
        }, g.cfg);
    } catch (err) { return rpcFailure(err, WHERE); }
    if (!result?.ok) return rpcRefusal(result, 'scanner_action_rejected', ['job_not_found']);
    return NextResponse.json({ ok: true, replayed: result.replayed === true }, { headers: NO_STORE });
}
