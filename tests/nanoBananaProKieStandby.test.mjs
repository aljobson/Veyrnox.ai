import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { submitTask, ENDPOINT } from '../packages/adapters/grsai.js';
import { classifySubmitFailure } from '../lib/supplierRoutesFailover.js';

const sql = readFileSync('packages/db/schema/supabase/0456_nano_banana_pro_kie_standby_route.sql', 'utf8');
const CAP = 0.01796; // ADR-0037
const job = { provider_endpoint: ENDPOINT, inputs: { prompt: 'A blue teapot' } };

async function withFetch(fn, run) {
    const real = globalThis.fetch;
    globalThis.fetch = fn;
    try { await run(); } finally { globalThis.fetch = real; }
}

test('GrsAI "insufficient credits" is a payment refusal and may be routed around', async () => {
    await withFetch(async () => Response.json({ code: -1, msg: 'insufficient credits' }), async () => {
        const r = await submitTask(job, { apiKey: 'k' });
        assert.deepEqual(r, { ok: false, error: 'provider_payment_required', outcome: 'rejected', errorCode: 'provider_payment_required' });
        assert.equal(classifySubmitFailure(r), 'failover');
    });
});

test('any other GrsAI refusal still stops: no message, other words, or a vendor message in the result', async () => {
    for (const body of [{ code: -1 }, { code: -1, msg: 'prompt blocked' }, { code: 500, msg: 'internal error' }, { code: -1, msg: 42 }]) {
        await withFetch(async () => Response.json(body), async () => {
            const r = await submitTask(job, { apiKey: 'k' });
            assert.equal(r.error, 'provider_request_rejected', JSON.stringify(body));
            assert.equal(classifySubmitFailure(r), 'stop', JSON.stringify(body));
        });
    }
    await withFetch(async () => Response.json({ code: -1, msg: 'insufficient credits for key sk-secret' }), async () => {
        assert.doesNotMatch(JSON.stringify(await submitTask(job, { apiKey: 'k' })), /sk-secret/);
    });
});

test('a GrsAI success is untouched by the rule', async () => {
    await withFetch(async () => Response.json({ code: 0, data: { id: '15-test-task' } }), async () => {
        assert.deepEqual(await submitTask(job, { apiKey: 'k' }), { ok: true, providerJobId: '15-test-task' });
    });
});

test('0456 adds one active kie route at priority 2 behind the GrsAI offer, with evidence, a waiver and a daily cap', () => {
    assert.match(sql, /'nano-banana-pro-grsai', 'kie', 'market:nano-banana-pro', 0\.0900, 'per_generation', 2, 'active', 'licensed_reseller'/);
    assert.match(sql, /26cba7722184e514a7373068284b82fa/, 'the probe task is the parity record');
    assert.match(sql, /margin_waiver_note/);
    assert.match(sql, /,\s*500\)\s*ON CONFLICT \(model_id, priority\) DO NOTHING/, 'daily_spend_cap_cents 500, idempotent');
    assert.match(sql, /<> 1 THEN/, 'it asserts exactly one row each way');
});

test('0456 touches no price, no catalog row and no other route; fal is not added', () => {
    // The redefined function legitimately updates job_attempts; everything outside it must not touch prices or rows.
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.job_route_failover(');
    const outside = sql.slice(0, start) + sql.slice(sql.indexOf('$$;', start) + 3);
    assert.doesNotMatch(outside, /UPDATE\s+public\./i);
    assert.doesNotMatch(outside, /DELETE\s+FROM/i);
    assert.doesNotMatch(outside, /INSERT INTO public\.model_catalog/i);
    assert.doesNotMatch(sql, /'fal',/);
});

test('the waiver is real: kie at $0.09 breaches the 2-credit cap, so 0373 would refuse the hop without it', () => {
    assert.ok(0.09 > 2 * CAP);
    assert.match(sql, /margin_waiver_note/);
});

test('route 1 is the guard: the migration refuses to run if the GrsAI route is not there', () => {
    assert.match(sql, /supplier = 'grsai' AND r\.priority = 1 AND r\.state = 'active'/);
    assert.match(sql, /RAISE EXCEPTION 'Expected one active GrsAI route 1/);
});

// Review of #2063: a job that failover sent to kie is completed by the kie callback, which looks the job up by its
// recorded supplier. The offer's own catalog row names GrsAI, so the lookup must follow the offer's routes.
import { findJob } from '../lib/providerCompletion.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'fixture' };
function db({ job, model, routes = [] }) {
    const asked = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
        const u = new URL(String(url));
        const table = u.pathname.split('/').pop();
        asked.push({ table, filter: u.searchParams.toString() });
        const rows = table === 'jobs' ? (job ? [job] : []) : table === 'model_catalog' ? (model ? [model] : []) : routes;
        return Response.json(rows);
    };
    return { asked, restore: () => { globalThis.fetch = real; } };
}
const hopped = { id: 'j1', user_id: 'u1', credits: 2, state: 'SUBMITTED', model_id: 'nano-banana-pro-grsai' };
const grsaiOffer = { provider: 'grsai', provider_endpoint: 'grsai:nano-banana-pro' };

test('a job failed over to kie is found by the kie callback and read from the kie route endpoint', async () => {
    const net = db({ job: hopped, model: grsaiOffer, routes: [{ endpoint: 'market:nano-banana-pro' }] });
    try {
        const found = await findJob(cfg, 'kie', 'abc123');
        assert.equal(found.id, 'j1');
        assert.equal(found.provider_endpoint, 'market:nano-banana-pro');
        const routeAsk = net.asked.find((c) => c.table === 'model_routes');
        assert.match(routeAsk.filter, /model_id=eq\.nano-banana-pro-grsai/);
        assert.match(routeAsk.filter, /supplier=eq\.kie/);
    } finally { net.restore(); }
});

test('a job whose provider is no route of its offer is still not ours to complete', async () => {
    const net = db({ job: hopped, model: grsaiOffer, routes: [] });
    try { assert.equal(await findJob(cfg, 'kie', 'abc123'), null); } finally { net.restore(); }
});

test('a job on its offer\'s own supplier never reads the routes table', async () => {
    const net = db({ job: { ...hopped, model_id: 'nano-banana-kie' }, model: { provider: 'kie', provider_endpoint: 'market:google/nano-banana' } });
    try {
        const found = await findJob(cfg, 'kie', 'abc123');
        assert.equal(found.provider_endpoint, 'market:google/nano-banana');
        assert.equal(net.asked.some((c) => c.table === 'model_routes'), false);
    } finally { net.restore(); }
});

test('an unknown job or catalog row is null without a route lookup', async () => {
    for (const world of [{ job: null }, { job: hopped, model: null }]) {
        const net = db(world);
        try { assert.equal(await findJob(cfg, 'kie', 'abc123'), null); assert.equal(net.asked.some((c) => c.table === 'model_routes'), false); }
        finally { net.restore(); }
    }
});

// Review of #2063: the stored cap must be enforced, not just recorded.
test('0456 enforces daily_spend_cap_cents inside job_route_failover: locked route row, UTC-day reservations, hop refused over the cap', () => {
    assert.match(sql, /FROM public\.model_routes WHERE id = p_next_route_id FOR UPDATE;/);
    assert.match(sql, /IF nxt\.daily_spend_cap_cents IS NOT NULL THEN/);
    assert.match(sql, /FROM public\.provider_spend_reservations r/);
    assert.match(sql, /r\.provider = nxt\.supplier AND r\.model_id = j\.model_id AND r\.purpose = 'job'/);
    assert.match(sql, /date_trunc\('day', now\(\) AT TIME ZONE 'UTC'\) AT TIME ZONE 'UTC'/);
    assert.match(sql, /> nxt\.daily_spend_cap_cents::bigint \* 10000/, 'cents to micro-dollars');
    assert.match(sql, /'code', 'route_daily_cap'/);
    assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.job_route_failover\(uuid, uuid, uuid\) TO service_role;/);
});

test('0456 keeps the rest of job_route_failover as 0376 wrote it (only the lock and the cap differ)', () => {
    const base = readFileSync('packages/db/schema/supabase/0376_route_circuit_breaker.sql', 'utf8');
    const grab = (text) => text.slice(text.indexOf('CREATE OR REPLACE FUNCTION public.job_route_failover('), text.indexOf('$$;', text.indexOf('CREATE OR REPLACE FUNCTION public.job_route_failover(')) + 3);
    const strip = (fn) => fn
        .replace('    spent BIGINT;\n', '')
        .replace(' FOR UPDATE;\n    IF NOT FOUND OR nxt.model_id', ';\n    IF NOT FOUND OR nxt.model_id')
        .replace(/    -- A route's own daily cap[\s\S]*?\n    END IF;\n\n(?=    spend :=)/, '');
    assert.equal(strip(grab(sql)), grab(base));
});
