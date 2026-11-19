/**
 * Host-only proof on a disposable database already migrated through main.
 * Applies only 0563, twice, and rolls back all DDL, fixtures and dispatch rows.
 * No provider calls or migration replay of older quote/submit implementations.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const DATABASE_URL = process.env.DATABASE_URL;

describe('music long-song pricing (0563)', { skip: !DATABASE_URL && 'DATABASE_URL not set', concurrency: false }, () => {
  let client;
  const rows = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows;
  const one = async (sql: string, params: unknown[] = []) => (await rows(sql, params))[0];

  before(async () => {
    const pg = (await import('pg')).default;
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const sql = await readFile(new URL('./schema/supabase/0563_music_long_song_duration_price.sql', import.meta.url), 'utf8');
    await client.query(sql);
    await client.query(sql);
    const updated = await client.query(`UPDATE public.model_catalog
      SET active=true, gated_flag=false, credits_5s=3
      WHERE id='ace-step-1.5' RETURNING provider, provider_endpoint, modality`);
    assert.equal(updated.rowCount, 1);
    assert.deepEqual(updated.rows[0], {
      provider: 'fal', provider_endpoint: 'fal-ai/ace-step-1.5', modality: 'text-to-audio',
    });
  });

  after(async () => {
    if (client) {
      try { await client.query('ROLLBACK'); } finally { await client.end(); }
    }
  });

  async function user(paid = true) {
    const authId = randomUUID();
    const { id } = await one('SELECT public.signup_grant($1,$2) AS id', [authId, `${authId}@test.veyrnox.ai`]);
    const grant = (await one("SELECT public.ledger_grant($1,200,'grant:test_music_long_song',$2) AS r", [id, randomUUID()])).r;
    assert.equal(grant.ok, true);
    if (paid) {
      const inserted = await client.query(`INSERT INTO public.credit_subscriptions
        (user_id,plan_id,idempotency_key,price_usd_cents,credits,consent_version,status,current_period_end)
        SELECT $1,id,$2,price_usd_cents,credits,'test-long-song','active',now()+interval '1 day'
        FROM public.credit_subscription_plans WHERE active ORDER BY id LIMIT 1`, [id, randomUUID()]);
      assert.equal(inserted.rowCount, 1, 'a migrated paid plan must exist');
    }
    return { authId, id };
  }

  async function quote(authId: string, duration: number | null, model = 'ace-step-1.5') {
    return (await one('SELECT public.music_create_quote($1,$2,$3,$4,NULL::integer,NULL::integer,NULL::text,$5::integer) AS r',
      [authId, 'warm harbour piano', 'Harbour', model, duration])).r;
  }

  async function submit(authId: string, quoteId: string, key = `long.${randomUUID()}`) {
    return (await one('SELECT public.music_submit_pair($1,$2::uuid,$3) AS r', [authId, quoteId, key])).r;
  }

  async function counts(userId: string) {
    return one(`SELECT
      (SELECT count(*)::int FROM public.music_prompt_specs WHERE user_id=$1) AS specs,
      (SELECT count(*)::int FROM public.music_generation_quotes WHERE user_id=$1) AS quotes,
      (SELECT count(*)::int FROM public.ledger_entries WHERE user_id=$1 AND delta<0) AS debits,
      (SELECT count(*)::int FROM public.jobs WHERE user_id=$1) AS jobs`, [userId]);
  }

  async function assertPrice(q, duration: number, unit: number) {
    assert.equal(q.ok, true, JSON.stringify(q));
    assert.equal(q.duration_seconds, duration);
    assert.equal(q.unit_credits, unit);
    assert.equal(q.total_credits, unit * 2);
    assert.equal(q.balance_after, q.balance - unit * 2);
    assert.equal(q.affordable, q.balance >= unit * 2);
    const frozen = await one(`SELECT q.unit_credits,q.total_credits,q.output_count,s.duration_seconds
      FROM public.music_generation_quotes q JOIN public.music_prompt_specs s ON s.id=q.prompt_spec_id
      WHERE q.id=$1`, [q.quote_id]);
    assert.deepEqual(frozen, { unit_credits: unit, total_credits: unit * 2, output_count: 2, duration_seconds: duration });
  }

  async function assertPair(result, unit: number, duration: number) {
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.job_ids.length, 2);
    assert.equal(new Set(result.job_ids).size, 2);
    const debits = await rows('SELECT delta FROM public.ledger_entries WHERE job_id=ANY($1::uuid[]) AND delta<0 ORDER BY job_id', [result.job_ids]);
    assert.deepEqual(debits, [{ delta: -unit }, { delta: -unit }]);
    const jobs = await rows('SELECT credits FROM public.jobs WHERE id=ANY($1::uuid[]) ORDER BY id', [result.job_ids]);
    assert.deepEqual(jobs, [{ credits: unit }, { credits: unit }]);
    const dispatch = await rows('SELECT payload FROM public.fal_dispatch WHERE job_id=ANY($1::uuid[])', [result.job_ids]);
    assert.equal(dispatch.length, 2);
    for (const row of dispatch) assert.equal(row.payload.duration, duration, 'existing trigger dispatches the frozen duration');
  }

  it('reapplies idempotently and grants only the intended function privileges', async () => {
    assert.equal((await one(`SELECT count(*)::int AS n FROM pg_catalog.pg_constraint
      WHERE conrelid='public.music_prompt_specs'::regclass
        AND conname='music_prompt_specs_duration_by_model_check'`)).n, 1);
    for (const signature of [
      'private.music_duration_price_blocks(text,integer)',
      'public.music_create_quote(text,text,text,text,integer,integer,text,integer)',
      'public.music_create_custom_quote(text,integer,boolean,boolean,integer)',
      'private.music_submit_pair_unbounded(text,uuid,text)',
    ]) {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const { allowed } = await one("SELECT has_function_privilege($1,$2,'EXECUTE') AS allowed", [role, signature]);
        assert.equal(allowed, role === 'service_role' && !signature.includes('unbounded'), `${role}: ${signature}`);
      }
    }
  });

  it('60 seconds retains the pre-migration JSON shape and values, with two 3-Credit debits', async () => {
    const owner = await user();
    // The previous duration wrapper returned this unchanged seven-arg result plus duration_seconds.
    const base = (await one('SELECT public.music_create_quote($1,$2,$3,$4,NULL::integer,NULL::integer,NULL::text) AS r',
      [owner.authId, 'warm harbour piano', 'Harbour', 'ace-step-1.5'])).r;
    assert.equal(base.ok, true);
    const q = await quote(owner.authId, 60);
    await assertPrice(q, 60, 3);
    const expected = { ...base, duration_seconds: 60 };
    assert.deepEqual(Object.keys(q).sort(), Object.keys(expected).sort());
    // IDs necessarily differ; expires_at is identical because both calls share one transaction.
    assert.deepEqual({ ...q, quote_id: base.quote_id }, expected);
    const made = await submit(owner.authId, q.quote_id);
    await assertPair(made, 3, 60);
    assert.equal(made.balance_after, q.balance_after);
  });

  it('quotes every 60-second block boundary from the catalog unit', async () => {
    const owner = await user();
    for (const [duration, unit] of [[10, 3], [59, 3], [61, 6], [120, 6], [121, 9], [180, 9]]) {
      await assertPrice(await quote(owner.authId, duration), duration, unit);
    }
  });

  it('180 seconds debits 9 twice and replaying the pair key adds no debit or dispatch', async () => {
    const owner = await user();
    const q = await quote(owner.authId, 180);
    await assertPrice(q, 180, 9);
    const key = `long.${randomUUID()}`;
    const made = await submit(owner.authId, q.quote_id, key);
    await assertPair(made, 9, 180);
    assert.equal(made.balance_after, q.balance_after);
    const beforeCounts = await counts(owner.id);
    const replay = await submit(owner.authId, q.quote_id, key);
    assert.equal(replay.ok, true);
    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.job_ids, made.job_ids);
    assert.equal(replay.balance_after, made.balance_after);
    assert.deepEqual(await counts(owner.id), beforeCounts);
    await assertPair(replay, 9, 180);
  });

  it('invalid durations create no prompt, quote, job or debit', async () => {
    const owner = await user();
    const beforeCounts = await counts(owner.id);
    for (const [model, duration] of [
      ['ace-step-1.5', 181], ['ace-step-1.5', 9], ['ace-step-1.5', null],
      ['ace-step', 61], ['ace-step-loop', 61],
    ] as [string, number | null][]) {
      assert.deepEqual(await quote(owner.authId, duration, model), { ok: false, code: 'INVALID_INPUTS' });
      assert.deepEqual(await counts(owner.id), beforeCounts);
    }
  });

  it('rejects a changed catalog price or timestamp without debiting', async () => {
    const owner = await user();
    for (const change of ['price', 'timestamp', 'both']) {
      const q = await quote(owner.authId, 180);
      const beforeCounts = await counts(owner.id);
      const beforeBalance = (await one('SELECT balance FROM public.credit_balances WHERE user_id=$1', [owner.id])).balance;
      await client.query('SAVEPOINT stale_catalog');
      try {
        const updated = await client.query(`UPDATE public.model_catalog
          SET credits_5s=credits_5s + CASE WHEN $1 THEN 1 ELSE 0 END,
              updated_at=updated_at + CASE WHEN $2 THEN interval '1 second' ELSE interval '0 seconds' END
          WHERE id='ace-step-1.5'`, [change !== 'timestamp', change !== 'price']);
        assert.equal(updated.rowCount, 1);
        assert.deepEqual(await submit(owner.authId, q.quote_id), { ok: false, code: 'QUOTE_STALE' });
        assert.deepEqual(await counts(owner.id), beforeCounts);
        assert.equal((await one('SELECT balance FROM public.credit_balances WHERE user_id=$1', [owner.id])).balance, beforeBalance);
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT stale_catalog');
        await client.query('RELEASE SAVEPOINT stale_catalog');
      }
    }
  });

  it('custom vocal and instrumental quotes inherit 180-second pricing', async () => {
    const owner = await user();
    assert.equal((await one('SELECT public.music_get_custom_draft($1) AS r', [owner.authId])).r.ok, true);
    const saved = (await one('SELECT public.music_save_custom_draft($1,0,$2,$3,$4,$5) AS r',
      [owner.authId, 'ace-step-1.5', '[Verse]\nHarbour lights', 'warm piano', 'Harbour'])).r;
    assert.equal(saved.ok, true);
    for (const instrumental of [false, true]) {
      const q = (await one('SELECT public.music_create_custom_quote($1,$2,$3,$4,180) AS r',
        [owner.authId, saved.draft.revision, instrumental, !instrumental])).r;
      await assertPrice(q, 180, 9);
      assert.equal(q.mode, 'custom');
      assert.equal(q.instrumental, instrumental);
      assert.equal(q.draft_revision, saved.draft.revision);
    }
  });

  it('the webhook refund RPC returns the long take’s recorded 9 Credits exactly once', async () => {
    const owner = await user();
    const q = await quote(owner.authId, 180);
    const made = await submit(owner.authId, q.quote_id);
    await assertPair(made, 9, 180);
    const job = await one('SELECT id,user_id,credits FROM public.jobs WHERE id=$1', [made.job_ids[0]]);
    // lib/falWebhookHandler.js passes these same persisted fields to ledger_refund.
    const refund = async () => (await one("SELECT public.ledger_refund($1,$2,$3,'refund:provider_failed') AS r",
      [job.id, job.user_id, job.credits])).r;
    const first = await refund();
    assert.equal(first.ok, true);
    assert.equal(first.idempotent, false);
    assert.equal(first.balance_after, made.balance_after + 9);
    const replay = await refund();
    assert.equal(replay.ok, true);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.balance_after, first.balance_after);
    assert.deepEqual(await rows("SELECT job_id,delta FROM public.ledger_entries WHERE job_id=ANY($1::uuid[]) AND reason LIKE 'refund:%'", [made.job_ids]),
      [{ job_id: job.id, delta: 9 }]);
  });

  it('ace-step and ace-step-loop keep flat catalog prices and the 60-second ceiling', async () => {
    const owner = await user();
    await client.query('SAVEPOINT legacy_models');
    try {
      // The loop model is intentionally inactive on main; enable only in this rolled-back fixture.
      const updated = await client.query(`UPDATE public.model_catalog SET active=true,gated_flag=false
        WHERE id IN ('ace-step','ace-step-loop') RETURNING id,credits_5s`);
      assert.equal(updated.rowCount, 2);
      for (const model of updated.rows) {
        for (const duration of [10, 60]) {
          await assertPrice(await quote(owner.authId, duration, model.id), duration, model.credits_5s);
        }
        const beforeCounts = await counts(owner.id);
        assert.deepEqual(await quote(owner.authId, 61, model.id), { ok: false, code: 'INVALID_INPUTS' });
        assert.deepEqual(await counts(owner.id), beforeCounts);
        const q = await quote(owner.authId, 60, model.id);
        await assertPair(await submit(owner.authId, q.quote_id), model.credits_5s, 60);
      }
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT legacy_models');
      await client.query('RELEASE SAVEPOINT legacy_models');
    }
  });

  it('the paid-plan gate remains enforced at quote and submit', async () => {
    const unpaid = await user(false);
    assert.deepEqual(await quote(unpaid.authId, 180), { ok: false, code: 'PLAN_UNAVAILABLE' });
    const owner = await user();
    const q = await quote(owner.authId, 180);
    assert.equal(q.ok, true);
    await client.query("UPDATE public.credit_subscriptions SET current_period_end=now()-interval '1 second' WHERE user_id=$1", [owner.id]);
    const beforeCounts = await counts(owner.id);
    assert.deepEqual(await submit(owner.authId, q.quote_id), { ok: false, code: 'PLAN_UNAVAILABLE' });
    assert.deepEqual(await counts(owner.id), beforeCounts);
  });

  it('preserves the ledger balance invariant', async () => {
    assert.deepEqual(await rows('SELECT * FROM public.reconcile_balances()'), []);
  });
});
