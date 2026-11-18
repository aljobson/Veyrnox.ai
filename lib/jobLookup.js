import { NextResponse } from 'next/server';
import { select, rpc } from '../packages/db/supabase-client.js';
import { IDEMPOTENCY_RE } from './validate.js';
import { publicJobState } from './jobState.js';
import { jobReadLimitResponse } from './jobReadLimit.js';

// Only an authoritative REFUNDED row proves the money was returned. A rejected
// submit whose refund RPC failed can still be DEBITED, indistinguishable here
// from an accepted job in flight. Never turn that uncertainty into "no charge".
export function jobLookupProjection(row) {
    const state = publicJobState(row.state);
    return {
        id: row.id, state, refunded: row.state === 'REFUNDED',
        refund_state: row.state === 'REFUNDED' ? 'confirmed' : row.state === 'FAILED' ? 'pending'
            : state === 'succeeded' ? 'none' : 'unknown',
    };
}

const reply = (body, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function lookupJobByKey(authId, key, cfg) {
    if (typeof key !== 'string' || !IDEMPOTENCY_RE.test(key)) return reply({ error: 'idempotency_key_required' }, 400);
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return reply({ error: 'not_configured' }, 503);
    try {
        // list_user_jobs resolves this predicate inside SQL; there is no shared
        // JS helper. Keep its internal-user quota and exclude tombstoned users.
        const users = await select('users', { columns: 'id',
            filter: `auth_id=eq.${encodeURIComponent(authId)}&deleted_at=is.null`, limit: 1 }, cfg);
        if (!Array.isArray(users)) return reply({ error: 'internal' }, 502);
        if (!users.length) return reply({ job: null });
        if (!users[0]?.id) return reply({ error: 'internal' }, 502);
        const userId = users[0].id;
        const rate = await rpc('consume_job_read_request', { p_user_id: userId }, cfg);
        const limited = jobReadLimitResponse(rate);
        if (limited) return limited;
        if (rate?.ok !== true) return reply({ error: 'internal' }, 502);
        const jobs = await select('jobs', { columns: 'id,state',
            filter: `user_id=eq.${encodeURIComponent(userId)}&idempotency_key=eq.${encodeURIComponent(key)}&deleted_at=is.null`, limit: 1 }, cfg);
        if (!Array.isArray(jobs) || (jobs.length && !jobs[0]?.id)) return reply({ error: 'internal' }, 502);
        return reply({ job: jobs.length ? jobLookupProjection(jobs[0]) : null });
    } catch {
        return reply({ error: 'internal' }, 502);
    }
}
