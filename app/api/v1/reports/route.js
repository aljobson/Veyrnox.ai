/**
 * POST /api/v1/reports — a user reports content (ADR-0083; Thorn Safety by
 * Design, Deploy mitigation 2).
 *
 *   { subject_kind: 'job' | 'cinema_title' | 'other', subject_id?, category, details? }
 *
 * One open report per person per subject; a repeat answers with the first.
 * The reporter is the middleware's identity, never a body field. The report
 * is read by an admin at /app/admin/reports; the reporter is not told the
 * outcome of a CSAM report, in line with the procedure.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { accountReadLimit } from '../../../../lib/accountReadLimit.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = new Set(['job', 'cinema_title', 'other']);
export const CATEGORIES = ['csam', 'intimate_image', 'real_person', 'violence', 'hate', 'fraud', 'copyright', 'other'];
const MAX_BODY_BYTES = 8 * 1024;
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId || !UUID_RE.test(authId)) return json({ error: 'not_authenticated' }, 401);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'not_configured' }, 503);
    const limited = await accountReadLimit(authId, cfg, { error: 'rate_limited' });
    if (limited) return limited;
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ error: 'body_too_large' }, 413);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'body_invalid' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'body_invalid' }, 400);
    const { subject_kind: kind, subject_id: subjectId = null, category, details = '' } = body;
    if (!KINDS.has(kind)) return json({ error: 'subject_invalid' }, 400);
    if (kind === 'other' ? subjectId !== null : (typeof subjectId !== 'string' || !UUID_RE.test(subjectId))) return json({ error: 'subject_invalid' }, 400);
    if (!CATEGORIES.includes(category)) return json({ error: 'category_invalid' }, 400);
    if (typeof details !== 'string' || details.length > 2000 || (kind === 'other' && details.trim().length < 10)) return json({ error: 'details_invalid' }, 400);

    let result;
    try {
        result = await rpc('submit_content_report', {
            p_auth_id: authId, p_subject_kind: kind, p_subject_id: subjectId, p_category: category, p_details: details.trim(),
        }, cfg);
    } catch (err) {
        console.error('[reports] submit failed:', err && err.message);
        return json({ error: 'reports_unavailable' }, 502);
    }
    if (!result || result.ok !== true) {
        const code = result && result.code ? String(result.code).toLowerCase() : 'report_rejected';
        return json({ error: code }, code === 'too_many_open_reports' ? 429 : 400);
    }
    return json({ report_id: result.report_id, replayed: result.replayed === true }, result.replayed === true ? 200 : 201);
}
