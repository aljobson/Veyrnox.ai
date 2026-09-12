/**
 * POST /api/admin/reap-assets — Worker consumer for the asset_reap_queue.
 *
 * Reads a batch from `public.asset_reap_queue`, deletes each r2_key from R2,
 * removes the queue row on success, otherwise bumps attempts + logs the error.
 *
 * Auth: shared secret `ADMIN_REAP_TOKEN` in header `x-veyrnox-admin-token`.
 * Not exposed to end users. Meant for a cron worker or manual replay.
 *
 * Response: { processed, deleted, failed, remaining? }.
 */

import { NextResponse } from 'next/server';
import { rpc, envConfig } from '../../../../packages/db/supabase-client.js';
import { deleteObject, isConfigured as r2IsConfigured, envConfig as r2EnvConfig } from '../../../../packages/adapters/r2.js';

const BATCH = 100;

// Constant-time compare via SHA-256 digests: equal-length inputs, no early exit.
async function tokenMatches(presented, expected) {
    if (typeof presented !== 'string' || !presented) return false;
    const enc = new TextEncoder();
    const [a, b] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(presented)),
        crypto.subtle.digest('SHA-256', enc.encode(expected)),
    ]);
    const va = new Uint8Array(a);
    const vb = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
    return diff === 0;
}

async function selectQueue(cfg, limit) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('select', 'id,r2_key,attempts');
    url.searchParams.set('order', 'queued_at.asc');
    url.searchParams.set('limit', String(limit));
    const res = await fetch(url, {
        headers: {
            apikey: cfg.serviceRoleKey,
            Authorization: `Bearer ${cfg.serviceRoleKey}`,
        },
    });
    if (!res.ok) return { ok: false, error: `queue read ${res.status}` };
    return { ok: true, rows: await res.json() };
}

async function markSuccess(cfg, id) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('id', `eq.${id}`);
    return fetch(url, {
        method: 'DELETE',
        headers: {
            apikey: cfg.serviceRoleKey,
            Authorization: `Bearer ${cfg.serviceRoleKey}`,
            Prefer: 'return=minimal',
        },
    });
}

async function markFail(cfg, id, attempts, err) {
    const url = new URL('/rest/v1/asset_reap_queue', cfg.supabaseUrl);
    url.searchParams.set('id', `eq.${id}`);
    return fetch(url, {
        method: 'PATCH',
        headers: {
            apikey: cfg.serviceRoleKey,
            Authorization: `Bearer ${cfg.serviceRoleKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
        },
        body: JSON.stringify({ attempts: attempts + 1, last_error: String(err).slice(0, 500) }),
    });
}

export async function POST(req) {
    const token = process.env.ADMIN_REAP_TOKEN;
    if (!token) return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    if (!(await tokenMatches(req.headers.get('x-veyrnox-admin-token'), token))) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const cfg = envConfig();
    const r2cfg = r2EnvConfig();
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey || !r2IsConfigured(r2cfg)) {
        return NextResponse.json({ error: 'not_configured' }, { status: 503 });
    }

    const q = await selectQueue(cfg, BATCH);
    if (!q.ok) {
        console.error('[reap-assets] queue read failed:', q.error);
        return NextResponse.json({ error: 'internal' }, { status: 502 });
    }

    let deleted = 0;
    let failed = 0;
    for (const row of q.rows) {
        try {
            const del = await deleteObject(row.r2_key, r2cfg);
            if (del.ok) {
                await markSuccess(cfg, row.id);
                deleted++;
            } else {
                await markFail(cfg, row.id, row.attempts, del.error);
                failed++;
            }
        } catch (err) {
            await markFail(cfg, row.id, row.attempts, err && err.message);
            failed++;
        }
    }

    return NextResponse.json({ processed: q.rows.length, deleted, failed });
}
