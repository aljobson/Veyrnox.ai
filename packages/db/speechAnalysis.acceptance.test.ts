/** Disposable LOCAL Postgres, with 0450–0452 already applied by its owner.
 * Never applies migrations. Tests normally roll back all fixtures. The concurrency test
 * commits isolated fixtures so two connections can see them, then erases the account;
 * its content-free financial audit rows remain (the ledger is append-only).
 * Run: node --test packages/db/speechAnalysis.acceptance.test.ts
 */
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
const url = process.env.SPEECH_ANALYSIS_TEST_DATABASE_URL || process.env.DATABASE_URL;
const model = 'elevenlabs-scribe-v2', fingerprint = 'a'.repeat(64);
describe('speech analysis RPC acceptance', { skip: !url && 'SPEECH_ANALYSIS_TEST_DATABASE_URL / DATABASE_URL not set' }, () => {
    let client: pg.Client, Pg: typeof pg, auth: string, user: string, source: string, asset: string;
    let policies: { active: boolean; credits: number; capacity: boolean; paused: boolean }, committed = false;
    const one = async (sql: string, args: unknown[] = [], conn = client) => (await conn.query(sql, args)).rows[0];
    const rpc = async (name: string, args: unknown[] = [], conn = client) => {
        assert.match(name, /^[a-z_]+$/); // Names here are fixed test constants; values are parameters.
        return (await one(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS value`, args, conn)).value;
    };
    before(async () => {
        assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url!).hostname), 'Use a disposable local database only');
        Pg = (await import('pg')).default; client = new Pg.Client({ connectionString: url }); await client.connect();
        await client.query("SET statement_timeout='15s'");
        assert.ok((await one("SELECT to_regprocedure('public.speech_analysis_request(text,uuid,numeric,text,integer)') AS fn")).fn, 'Owner must provision current migrations first');
    });
    beforeEach(async () => {
        committed = false; await client.query('BEGIN');
        policies = await one(`SELECT m.active,m.credits_5s AS credits,c.enabled AS capacity,a.paused
            FROM public.model_catalog m CROSS JOIN public.fal_capacity_policy c CROSS JOIN public.fal_admission_control a
            WHERE m.id=$1 AND c.singleton AND a.singleton`, [model]);
        assert.ok(policies);
        // Test fixture only: direct ledger_debit is refused under reserved-only fal capacity.
        // The production migration keeps the catalog OFF and never changes either policy.
        assert.equal((await client.query('UPDATE public.model_catalog SET active=true,credits_5s=2 WHERE id=$1', [model])).rowCount, 1);
        await client.query('UPDATE public.fal_capacity_policy SET enabled=false WHERE singleton');
        await client.query('UPDATE public.fal_admission_control SET paused=false WHERE singleton');
        auth = randomUUID();
        // Exercise the auth provisioning trigger, never insert public.users/balances directly.
        await client.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, `${auth}@example.test`]);
        user = (await one('SELECT id FROM public.users WHERE auth_id=$1', [auth])).id;
        assert.equal((await rpc('ledger_grant', [user, 100, 'grant:test_speech', randomUUID()])).ok, true);
        ({ source, asset } = await makeSource());
    });
    async function invariant() {
        const row = await one(`SELECT b.balance,COALESCE(sum(l.delta),0)::integer AS ledger FROM public.credit_balances b
            LEFT JOIN public.ledger_entries l ON l.user_id=b.user_id WHERE b.user_id=$1 GROUP BY b.balance`, [user]);
        assert.equal(row.balance, row.ledger);
        assert.deepEqual((await client.query('SELECT * FROM public.reconcile_balances()')).rows, []);
    }
    afterEach(async () => {
        try { await invariant(); } finally {
            if (!committed) await client.query('ROLLBACK');
            else {
                // Restore every committed fixture policy even when the race assertion failed.
                await client.query('ROLLBACK'); await client.query('BEGIN');
                await client.query('UPDATE public.model_catalog SET active=$2,credits_5s=$3 WHERE id=$1', [model, policies.active, policies.credits]);
                await client.query('UPDATE public.fal_capacity_policy SET enabled=$1 WHERE singleton', [policies.capacity]);
                await client.query('UPDATE public.fal_admission_control SET paused=$1 WHERE singleton', [policies.paused]);
                const attempts = await client.query("SELECT id FROM public.jobs WHERE user_id=$1 AND inputs->>'kind'='speech_analysis'", [user]);
                for (const row of attempts.rows) await rpc('speech_analysis_fail', [row.id, 'test_cleanup']);
                await erase(); await client.query('COMMIT');
            }
        }
    });
    after(async () => { if (client) await client.end(); });
    async function makeSource(duration = 12, mime = 'video/mp4') {
        const source = (await one(`INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,inputs,state)
            VALUES($1,$2,$3,0,'{}','STORED') RETURNING id`, [user, randomUUID(), model])).id;
        const asset = (await one(`INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes,sha256,expires_at)
            VALUES($1,$2,$3,500,$4,now()+interval '90 days') RETURNING id`, [source, randomUUID(), mime, fingerprint])).id;
        const probe = await rpc('speech_source_probe_store', [auth, source, fingerprint, duration, mime]);
        if (mime === 'video/mp4') assert.equal(probe.ok, true);
        return { source, asset };
    }
    const request = (key = randomUUID(), sourceId = source, duration = 12, credits = 2, conn = client) => rpc('speech_analysis_request', [auth, sourceId, duration, key, credits], conn);
    const analysis = () => ({ version: 1, assetId: source, duration: 12, provider: 'fal-scribe-v2', language: 'en', transcript: 'private speech', chunks: [{ start: 1, end: 2, text: 'private speech' }] });
    async function complete(id: string) {
        assert.equal((await rpc('speech_analysis_callback', [id, `provider-${id}`])).ok, true);
        assert.equal((await rpc('speech_analysis_complete', [id, analysis()])).ok, true);
    }
    async function counts(id: string) {
        return one('SELECT count(*) FILTER(WHERE delta<0)::int AS debits,count(*) FILTER(WHERE delta>0)::int AS refunds FROM public.ledger_entries WHERE job_id=$1', [id]);
    }
    async function erase() {
        const prepared = await rpc('prepare_account_deletion', [auth]); assert.equal(prepared.eligible, true, JSON.stringify(prepared));
        assert.equal((await rpc('erase_account', [auth, prepared.confirmation_token])).ok, true);
    }
    it('trusted probe/type/duration, foreign asset and atomic quote reject before debit', async () => {
        const other = randomUUID();
        assert.equal((await rpc('speech_analysis_request', [other, source, 12, randomUUID(), 2])).code, 'NOT_FOUND');
        assert.equal((await request(randomUUID(), source, 11)).code, 'DURATION_MISMATCH');
        assert.equal((await request(randomUUID(), source, 12, 3)).code, 'PRICE_CHANGED');
        const long = await makeSource(61); assert.equal((await request(randomUUID(), long.source)).code, 'SOURCE_TOO_LONG');
        const unsupported = await makeSource(12, 'image/png'); assert.equal((await request(randomUUID(), unsupported.source)).code, 'SOURCE_UNSUPPORTED');
        await client.query('DELETE FROM public.speech_source_probes WHERE asset_id=$1', [asset]);
        assert.equal((await request()).code, 'SOURCE_UNSUPPORTED');
        assert.equal((await one('SELECT count(*)::int AS n FROM public.ledger_entries WHERE user_id=$1 AND delta<0', [user])).n, 0);
    });
    it('reserved-only capacity guard remains effective; direct work order cannot bypass it', async () => {
        await client.query('UPDATE public.fal_capacity_policy SET enabled=true WHERE singleton');
        assert.equal((await request()).code, 'PROVIDER_ADMISSION_PAUSED');
        assert.equal((await one('SELECT count(*)::int AS n FROM public.speech_analyses WHERE user_id=$1', [user])).n, 0);
    });
    it('same key debits once, current-state replay after refund never pays again', async () => {
        const key = randomUUID(), first = await request(key); assert.equal(first.fresh, true);
        assert.equal((await request(key)).id, first.id); assert.deepEqual(await counts(first.id), { debits: 1, refunds: 0 });
        for (let i = 0; i < 2; i++) assert.equal((await rpc('speech_analysis_fail', [first.id, 'provider_failed'])).refunded, true);
        assert.deepEqual(await counts(first.id), { debits: 1, refunds: 1 });
        assert.equal((await request(key)).status, 'failed'); assert.equal((await request(key)).refunded, true);
    });
    it('different-key joins and cached requests retain receipts; conflicting source is 409 equivalent', async () => {
        const first = await request(), key = randomUUID(); const joined = await request(key);
        assert.equal(joined.id, first.id); assert.equal(joined.kind, 'joined_in_flight');
        const other = await makeSource(); assert.equal((await request(key, other.source)).code, 'IDEMPOTENCY_CONFLICT');
        await complete(first.id); const cacheKey = randomUUID(), cached = await request(cacheKey);
        assert.equal(cached.kind, 'reused_cache'); assert.equal(cached.id, first.id);
        assert.equal((await rpc('speech_analysis_by_key', [auth, key])).status, 'completed');
        assert.equal((await rpc('speech_analysis_by_key', [auth, cacheKey])).kind, 'reused_cache');
        assert.deepEqual(await counts(first.id), { debits: 1, refunds: 0 });
    });
    it('joiner retries after failure map to failed/refunded attempt without buying again', async () => {
        const first = await request(), joinKey = randomUUID(); await request(joinKey);
        await rpc('speech_analysis_fail', [first.id, 'provider_failed']);
        const replay = await request(joinKey); assert.equal(replay.id, first.id); assert.equal(replay.status, 'failed'); assert.equal(replay.refunded, true);
        assert.deepEqual(await counts(first.id), { debits: 1, refunds: 1 });
    });
    it('completion is one-shot STORED, never refunded; owner-only read and source checks', async () => {
        const first = await request(); await complete(first.id); await complete(first.id);
        assert.equal((await rpc('speech_analysis_fail', [first.id, 'late_error'])).refunded, false);
        const got = await rpc('speech_analysis_get', [auth, first.id]); assert.deepEqual(got.analysis, analysis());
        assert.equal((await rpc('speech_analysis_get', [randomUUID(), first.id])).code, 'NOT_FOUND');
        assert.equal((await one('SELECT state FROM public.jobs WHERE id=$1', [first.id])).state, 'STORED');
        assert.deepEqual(await counts(first.id), { debits: 1, refunds: 0 });
        await client.query('UPDATE public.assets SET expires_at=now()-interval \'1 second\' WHERE id=$1', [asset]);
        assert.equal((await rpc('speech_analysis_get', [auth, first.id])).code, 'NOT_FOUND');
    });
    it('invalid completion fails and refunds once', async () => {
        const first = await request(); await rpc('speech_analysis_callback', [first.id, 'provider-id']);
        const invalid = { ...analysis(), vendor_url: 'private' };
        await rpc('speech_analysis_complete', [first.id, invalid]); await rpc('speech_analysis_complete', [first.id, invalid]);
        assert.deepEqual(await counts(first.id), { debits: 1, refunds: 1 });
    });
    for (const state of ['DEBITED', 'SUBMITTED']) it(`${state} unknown submit times out, releases cap, ignores late success`, async () => {
        const ids: string[] = [];
        for (let i = 0; i < 3; i++) { const s = i ? await makeSource() : { source }; const a = await request(randomUUID(), s.source); assert.equal(a.ok, true); ids.push(a.id); }
        const fourth = await makeSource(); assert.equal((await request(randomUUID(), fourth.source)).code, 'RATE_LIMITED');
        for (const id of ids) {
            if (state === 'SUBMITTED') await rpc('speech_analysis_callback', [id, `provider-${id}`]);
            else await rpc('job_submit_rejected', [id, 'provider_outcome_unknown']);
        }
        await client.query("UPDATE public.jobs SET created_at=now()-interval '16 minutes',updated_at=now()-interval '16 minutes' WHERE id=ANY($1::uuid[])", [ids]);
        await client.query("UPDATE public.speech_analyses SET created_at=now()-interval '16 minutes' WHERE job_id=ANY($1::uuid[])", [ids]);
        await rpc('sweep_stuck_jobs'); // Generic hold must leave these to the speech timeout policy.
        assert.deepEqual(await counts(ids[0]), { debits: 1, refunds: 0 });
        await rpc('sweep_speech_analyses'); await rpc('sweep_speech_analyses');
        for (const id of ids) {
            assert.deepEqual(await counts(id), { debits: 1, refunds: 1 });
            assert.equal((await rpc('speech_analysis_get', [auth, id])).status, 'failed');
            assert.equal((await rpc('speech_analysis_callback', [id, `provider-${id}`])).closed, true);
            assert.equal((await rpc('speech_analysis_complete', [id, analysis()])).ignored, true);
        }
        assert.equal((await request(randomUUID(), fourth.source)).fresh, true);
    });
    it('unknown without id and lost job_submitted acknowledgment reconcile through callback', async () => {
        const first = await request(); await rpc('job_submit_rejected', [first.id, 'provider_outcome_unknown']);
        await complete(first.id); assert.deepEqual(await counts(first.id), { debits: 1, refunds: 0 });
        const s = await makeSource(), second = await request(randomUUID(), s.source);
        await rpc('job_submitted', [second.id, 'fal', `provider-${second.id}`]); // Simulate lost network ACK after commit.
        assert.equal((await rpc('speech_analysis_callback', [second.id, `provider-${second.id}`])).assetId, s.source);
        assert.equal((await rpc('speech_analysis_complete', [second.id, { ...analysis(), assetId: s.source }])).ok, true);
        assert.deepEqual(await counts(second.id), { debits: 1, refunds: 0 });
    });
    it('day 31 creates a new paid attempt and replaces cache; expired receipt is a tombstone', async () => {
        const oldKey = randomUUID(), first = await request(oldKey); await complete(first.id);
        const cacheKey = randomUUID(); await request(cacheKey);
        await client.query("UPDATE public.speech_analyses SET created_at=now()-interval '31 days' WHERE job_id=$1", [first.id]);
        await client.query("UPDATE public.speech_analysis_cache SET expires_at=now()-interval '1 day' WHERE user_id=$1", [user]);
        assert.equal((await request(cacheKey)).code, 'RESULT_EXPIRED');
        const next = await request(); assert.equal(next.fresh, true); assert.notEqual(next.id, first.id); await complete(next.id);
        assert.equal((await request()).id, next.id); await rpc('sweep_speech_analyses');
        assert.equal((await request(oldKey)).code, 'RESULT_EXPIRED');
        assert.equal((await one('SELECT count(*)::int AS n FROM public.speech_analysis_cache WHERE user_id=$1', [user])).n, 1);
        assert.deepEqual(await counts(next.id), { debits: 1, refunds: 0 });
    });
    for (const path of ['delete', 'expire', 'erase']) it(`${path} removes analysis/probe/cache; late callback closed`, async () => {
        const first = await request();
        if (path === 'erase') { await complete(first.id); await erase(); }
        else if (path === 'delete') assert.equal((await rpc('delete_user_job', [auth, source])).ok, true);
        else { await client.query("UPDATE public.assets SET expires_at=now()-interval '1 second' WHERE id=$1", [asset]); await rpc('expire_assets'); }
        for (const table of ['speech_analyses', 'speech_source_probes', 'speech_analysis_cache']) assert.equal((await one(`SELECT count(*)::int AS n FROM public.${table} WHERE user_id=$1`, [user])).n, 0);
        assert.equal((await rpc('speech_analysis_get', [auth, first.id])).code, 'NOT_FOUND');
        assert.equal((await rpc('speech_analysis_callback', [first.id, `provider-${first.id}`])).closed, true);
        assert.equal((await rpc('speech_analysis_complete', [first.id, analysis()])).ignored, true);
        assert.deepEqual(await counts(first.id), { debits: 1, refunds: path === 'erase' ? 0 : 1 });
    });
    it('completed/refunded analyses never enqueue creation pushes or appear in Library/delete', async () => {
        assert.equal((await rpc('register_push_token', [auth, `ExpoPushToken[${randomUUID()}]`, 'ios', randomUUID(), '1.0', true])).ok, true);
        const first = await request(); await complete(first.id);
        const s = await makeSource(), second = await request(randomUUID(), s.source); await rpc('speech_analysis_fail', [second.id, 'provider_failed']);
        await rpc('push_enqueue_job_events');
        assert.equal((await one('SELECT count(*)::int AS n FROM public.push_outbox WHERE job_id=ANY($1::uuid[])', [[first.id, second.id]])).n, 0);
        const list = await rpc('list_user_jobs', [auth]); assert.ok(list.jobs.every((j: { job_id: string }) => ![first.id, second.id].includes(j.job_id)));
        for (const id of [first.id, second.id]) for (const fn of ['get_user_job', 'get_user_job_cancel', 'delete_user_job']) assert.equal((await rpc(fn, [auth, id])).code, 'NOT_FOUND');
    });
    it('completion before the timeout sweep wins; replay/cache/join ignore new-work capacity', async () => {
        const key = randomUUID(), first = await request(key), joinKey = randomUUID();
        await client.query('UPDATE public.fal_capacity_policy SET enabled=true WHERE singleton');
        assert.equal((await request(joinKey)).id, first.id);
        await complete(first.id);
        await client.query("UPDATE public.jobs SET created_at=now()-interval '16 minutes' WHERE id=$1", [first.id]);
        await client.query("UPDATE public.speech_analyses SET created_at=now()-interval '16 minutes' WHERE job_id=$1", [first.id]);
        await rpc('sweep_speech_analyses');
        assert.equal((await request(key)).status, 'completed');
        assert.equal((await request()).kind, 'reused_cache');
        assert.deepEqual(await counts(first.id), { debits: 1, refunds: 0 });
    });
    it('two genuinely concurrent different-key requests serialize into one charged attempt', async () => {
        // Committed fixtures are necessary for two connections to observe the same source.
        await client.query('COMMIT'); committed = true;
        const peer = new Pg.Client({ connectionString: url }); await peer.connect();
        try {
            await peer.query("SET statement_timeout='15s'");
            const [a, b] = await Promise.all([request(), request(randomUUID(), source, 12, 2, peer)]);
            assert.equal(a.ok, true); assert.equal(b.ok, true); assert.equal(a.id, b.id);
            assert.deepEqual([a.kind, b.kind].sort(), ['joined_in_flight', 'new']); assert.deepEqual(await counts(a.id), { debits: 1, refunds: 0 });
        } finally { await peer.end(); }
    });
    it('RPC/table ACLs and forced RLS expose no transcript to browser roles', async () => {
        for (const table of ['speech_analyses', 'speech_source_probes', 'speech_analysis_cache', 'speech_analysis_requests']) {
            const row = await one('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', [`public.${table}`]); assert.equal(row.relrowsecurity, true); assert.equal(row.relforcerowsecurity, true);
            for (const role of ['anon', 'authenticated']) assert.equal((await one("SELECT has_table_privilege($1,$2,'SELECT') AS allowed", [role, `public.${table}`])).allowed, false);
        }
        for (const fn of ['speech_analysis_request(text,uuid,numeric,text,integer)', 'speech_analysis_get(text,uuid)', 'speech_analysis_by_key(text,text)', 'speech_analysis_complete(uuid,jsonb)', 'speech_analysis_fail(uuid,text)', 'sweep_speech_analyses()']) {
            const row = await one('SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure', [`public.${fn}`]); assert.equal(row.prosecdef, true); assert.ok(row.proconfig.includes('search_path=""'));
            for (const role of ['anon', 'authenticated']) assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [role, `public.${fn}`])).allowed, false);
        }
    });
});
