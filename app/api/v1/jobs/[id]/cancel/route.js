import { NextResponse } from 'next/server';
import { jobReadLimitResponse } from '../../../../../../lib/jobReadLimit.js';
import { rpc, envConfig } from '../../../../../../packages/db/supabase-client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFUSALS = {
    NOT_FOUND: [404, 'not_found'],
    ACCOUNT_FROZEN: [403, 'account_frozen'],
    JOB_STARTED: [409, 'job_started'],
    JOB_FINISHED: [409, 'job_finished'],
};
const json = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function handle(req, { params }, cancel) {
    const authId = req.headers.get('x-veyrnox-auth-id');
    if (!authId) return json({ error: 'not_authenticated' }, 401);
    if (process.env.JOB_CANCEL_ENABLED !== 'true') return json({ error: 'not_found' }, 404);
    const { id } = await params;
    if (!id || !UUID_RE.test(id)) return json({ error: 'invalid_job_id' }, 400);
    const cfg = envConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return json({ error: 'not_configured' }, 503);
    let row;
    try {
        row = await rpc(cancel ? 'cancel_user_job' : 'get_user_job_cancel', { p_auth_id: authId, p_job_id: id }, cfg);
    } catch {
        console.error('JOB_CANCEL_RPC_FAILED');
        return json({ error: 'internal' }, 502);
    }
    const limited = jobReadLimitResponse(row);
    if (limited) return limited;
    if (row?.ok === true) {
        return json(cancel
            ? { cancelled: true, replayed: row.replayed === true, credits: row.credits }
            : { cancellable: row.cancellable, credits: row.credits });
    }
    const refusal = (cancel || row?.code === 'NOT_FOUND') && REFUSALS[row?.code];
    if (refusal) return json({ error: refusal[1] }, refusal[0]);
    console.error('JOB_CANCEL_UNEXPECTED_ANSWER');
    return json({ error: 'internal' }, 502);
}

// Advisory only: a dispatch claim can win between GET and POST; POST then says job_started.
export async function GET(req, context) { return handle(req, context, false); }
export async function POST(req, context) { return handle(req, context, true); }
