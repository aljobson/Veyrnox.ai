/** Acceptance checks for migration 0592. Requires a disposable migrated local DB. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = process.env.CRUN_SUNO_MUSIC_TEST_DATABASE_URL || process.env.DATABASE_URL;
const local = (() => {
  if (!url) return false;
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname); } catch { return false; }
})();

describe('Crun Suno shared consumers (0592)', { skip: !local && 'disposable localhost database not set' }, () => {
  let pool: any;
  let client: any;
  const one = async (sql: string, args: unknown[] = []) => (await client.query(sql, args)).rows[0];
  const payload = { model: 'suno/music-generate', input: { mode: 'simple', prompt: 'private fixture', instrumental: true, suno_model: 'v6' } };
  const user = async () => {
    const auth = randomUUID();
    const id = (await one('SELECT public.signup_grant($1,$2) id', [auth, `${randomUUID()}@0592.accept.test`])).id;
    return { auth, id: id as string };
  };
  const debit = async (userId: string) => {
    const r = (await one(`SELECT public.ledger_debit($1,$2,1,'debit:generation','ace-step',$3::jsonb) r`,
      [userId, `consumer.${randomUUID()}`, JSON.stringify({ kind: 'music', prompt: 'private fixture' })])).r;
    assert.equal(r.ok, true);
    return r.job_id as string;
  };
  const dispatch = async (job: string, state = 'READY') => client.query(`INSERT INTO public.crun_dispatch
    (job_id,endpoint,payload,state,retry_at,attempt_count) VALUES($1,'crun:suno/music-generate',$2,$3,
      CASE WHEN $3='DEFERRED' THEN clock_timestamp()-interval '1 second' ELSE NULL END,CASE WHEN $3='DEFERRED' THEN 1 ELSE 0 END)`,
  [job, payload, state]);
  const refunds = async (job: string) => Number((await one(
    'SELECT count(*) n FROM public.ledger_entries WHERE job_id=$1 AND delta>0', [job])).n);
  let seq = 0;
  const isolated = async (fn: () => Promise<void>) => {
    const name = `c0592_${seq += 1}`;
    await client.query(`SAVEPOINT ${name}`);
    try { await fn(); } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await client.query(`RELEASE SAVEPOINT ${name}`);
    }
  };

  before(async () => {
    const pg = (await import('pg')).default;
    pool = new pg.Pool({ connectionString: url, max: 4 });
    client = await pool.connect();
    await client.query("SET TIME ZONE 'UTC'");
    await client.query('BEGIN');
    // 0611 unlists ACE in production; 0592's rolled-back consumer fixtures require it active.
    await client.query("UPDATE public.model_catalog SET active=true WHERE id IN ('ace-step','ace-step-1.5')");
  });
  after(async () => {
    if (client) { await client.query('ROLLBACK'); client.release(); }
    if (pool) await pool.end();
  });

  it('fences account pause and resume against stale auth evidence', async () => isolated(async () => {
    await client.query("UPDATE public.provider_spend_provider_policy SET admission_open=true,admission_fence=0,admission_observed_at=NULL,admission_resumed_at=NULL WHERE provider='crun'");
    const observed = (await one('SELECT clock_timestamp() t')).t;
    const paused = (await one("SELECT public.pause_crun_account_admission('provider_auth_failed',$1) r", [observed])).r;
    assert.equal(paused.ok, true);
    const resumed = (await one('SELECT public.resume_crun_account_admission($1) r', [paused.fence])).r;
    assert.equal(resumed.ok, true);
    assert.equal((await one("SELECT public.pause_crun_account_admission('provider_auth_failed',$1) r", [observed])).r.code, 'STALE_EVIDENCE');
    assert.equal((await one("SELECT admission_open FROM public.provider_spend_provider_policy WHERE provider='crun'")).admission_open, true);
  }));

  it('enforces fifteen TaskInfo reservations at the rolling one-second edge', async () => isolated(async () => {
    await client.query('DELETE FROM public.crun_taskinfo_reservations');
    for (let i = 0; i < 15; i += 1) {
      assert.equal((await one('SELECT public.reserve_crun_taskinfo_slot($1,$2) r',
        [`taskinfo.${i}.${randomUUID()}`, 'acceptance.poll'])).r.ok, true);
    }
    assert.equal((await one('SELECT public.reserve_crun_taskinfo_slot($1,$2) r',
      [`taskinfo.block.${randomUUID()}`, 'acceptance.poll'])).r.code, 'CRUN_TASKINFO_RATE_LIMITED');
    await client.query("UPDATE public.crun_taskinfo_reservations SET reserved_at=clock_timestamp()-interval '1.001 seconds'");
    assert.equal((await one('SELECT public.reserve_crun_taskinfo_slot($1,$2) r',
      [`taskinfo.edge.${randomUUID()}`, 'acceptance.poll'])).r.ok, true);
  }));

  it('records monotonic authoritative status and reports its age', async () => isolated(async () => {
    const u = await user(); const job = await debit(u.id); await dispatch(job, 'READY');
    await client.query("UPDATE public.crun_dispatch SET state='ACCEPTED',provider_job_id='status-task',resolved_at=clock_timestamp()-interval '46 minutes',projected_at=clock_timestamp() WHERE job_id=$1", [job]);
    assert.equal((await one("SELECT public.job_submitted($1,'crun','status-task') r", [job])).r.ok, true);
    const observed = (await one("SELECT clock_timestamp()-interval '1 minute' t")).t;
    assert.equal((await one("SELECT public.record_crun_task_status($1,'pending',$2) r", [job, observed])).r.ok, true);
    assert.equal((await one("SELECT public.record_crun_task_status($1,'running',$2::timestamptz-interval '1 second') r", [job, observed])).r.code, 'STALE_EVIDENCE');
    const row = await one('SELECT last_authoritative_status,last_authoritative_at FROM public.crun_dispatch WHERE job_id=$1', [job]);
    assert.equal(row.last_authoritative_status, 'pending'); assert.ok(row.last_authoritative_at);
    const health = (await one('SELECT public.crun_dispatch_health() r')).r;
    assert.ok(Number(health.authoritative_pending) >= 1);
    assert.ok(Number(health.authoritative_pending_max_age_minutes) >= 45);
  }));

  it('returns progressive backoff data from each claim', async () => isolated(async () => {
    await client.query("UPDATE public.provider_spend_provider_policy SET admission_open=true WHERE provider='crun'");
    const u = await user(); const job = await debit(u.id); await dispatch(job, 'READY');
    for (const [attempt, delay] of [[0, 30], [1, 60], [2, 120]] as const) {
      await client.query("UPDATE public.crun_dispatch SET state='DEFERRED',attempt_count=$2,retry_at=clock_timestamp()-make_interval(secs=>$3) WHERE job_id=$1", [job, attempt, delay]);
      const claim = (await one('SELECT public.claim_crun_dispatch($1) r', [job])).r;
      assert.equal(Number(claim.attempt_count), attempt);
      assert.ok(claim.retry_at);
      await client.query("UPDATE public.crun_dispatch SET state='READY',attempt_token=NULL WHERE job_id=$1", [job]);
    }
  }));

  it('returns provider_contract on a music pair replay', async () => isolated(async () => {
    const u = await user();
    const quote = (await one("SELECT public.music_create_quote($1,'replay route',NULL,'ace-step') r", [u.auth])).r;
    assert.equal(quote.ok, true);
    const key = `replay.${randomUUID()}`;
    const first = (await one('SELECT public.music_submit_pair($1,$2,$3) r', [u.auth, quote.quote_id, key])).r;
    const replay = (await one('SELECT public.music_submit_pair($1,$2,$3) r', [u.auth, quote.quote_id, key])).r;
    assert.equal(first.ok, true); assert.equal(replay.idempotent, true);
    assert.equal(replay.provider_contract, first.provider_contract);
  }));

  for (const state of ['READY', 'DEFERRED']) {
    it(`cancels ${state} Crun work and refunds exactly once`, async () => isolated(async () => {
      const u = await user(); const job = await debit(u.id); await dispatch(job, state);
      const projected = (await one('SELECT public.get_user_job_cancel($1,$2) r', [u.auth, job])).r;
      assert.equal(projected.cancellable, true);
      const first = (await one('SELECT public.cancel_user_job($1,$2) r', [u.auth, job])).r;
      const replay = (await one('SELECT public.cancel_user_job($1,$2) r', [u.auth, job])).r;
      assert.equal(first.ok, true); assert.equal(replay.replayed, true); assert.equal(await refunds(job), 1);
      const row = await one('SELECT state,attempt_token,retry_at FROM public.crun_dispatch WHERE job_id=$1', [job]);
      assert.deepEqual(row, { state: 'CLOSED', attempt_token: null, retry_at: null });
    }));
  }

  it('serializes cancel against recovery under the job-then-dispatch lock', async () => {
    // Like 0591's concurrency cases, this uses dedicated connections because a
    // PostgreSQL transaction is bound to one serial session. The disposable DB
    // retains the random-id fixture; users are never deleted.
    const auth = randomUUID();
    const userId = (await pool.query('SELECT public.signup_grant($1,$2) id', [auth, `${randomUUID()}@race.accept.test`])).rows[0].id;
    const debitResult = (await pool.query(`SELECT public.ledger_debit($1,$2,1,'debit:generation','ace-step',$3::jsonb) r`,
      [userId, `race.${randomUUID()}`, JSON.stringify({ kind: 'music' })])).rows[0].r;
    const job = debitResult.job_id;
    await pool.query(`INSERT INTO public.crun_dispatch(job_id,endpoint,payload,state,retry_at,attempt_count)
      VALUES($1,'crun:suno/music-generate',$2,'DEFERRED',clock_timestamp()-interval '1 second',1)`, [job, payload]);
    const left = await pool.connect(); const right = await pool.connect();
    try {
      await right.query('BEGIN');
      const recovery = (await right.query('SELECT public.recover_crun_dispatch(25) r')).rows[0].r;
      assert.equal((await right.query('SELECT state FROM public.crun_dispatch WHERE job_id=$1', [job])).rows[0].state, 'READY');
      const cancelPromise = left.query('SELECT public.cancel_user_job($1,$2) r', [auth, job]);
      await right.query('COMMIT');
      const cancel = (await cancelPromise).rows[0].r;
      assert.equal(cancel.ok, true); assert.equal(recovery.ok, true);
      assert.equal(Number((await pool.query('SELECT count(*) n FROM public.ledger_entries WHERE job_id=$1 AND delta>0', [job])).rows[0].n), 1);
      assert.equal((await pool.query('SELECT state FROM public.crun_dispatch WHERE job_id=$1', [job])).rows[0].state, 'CLOSED');
    } finally {
      await right.query('ROLLBACK').catch(() => {}); left.release(); right.release();
    }
  });

  it('redacts a settled Crun payload and refuses a live one', async () => isolated(async () => {
    const u = await user();
    const live = await debit(u.id); await dispatch(live, 'READY');
    assert.equal((await one('SELECT public.delete_user_job($1,$2) r', [u.auth, live])).r.code, 'IN_PROGRESS');
    const settled = await debit(u.id); await dispatch(settled, 'CLOSED');
    assert.equal((await one("SELECT public.ledger_refund($1,$2,1,'refund:acceptance') r", [settled, u.id])).r.ok, true);
    assert.equal((await one('SELECT public.delete_user_job($1,$2) r', [u.auth, settled])).r.ok, true);
    assert.deepEqual((await one('SELECT payload FROM public.crun_dispatch WHERE job_id=$1', [settled])).payload, {});
  }));

  it('scrubs Crun payloads when an account is tombstoned', async () => isolated(async () => {
    const u = await user(); const job = await debit(u.id); await dispatch(job, 'CLOSED');
    assert.equal((await one("SELECT public.ledger_refund($1,$2,1,'refund:acceptance') r", [job, u.id])).r.ok, true);
    const prepared = (await one('SELECT public.prepare_account_deletion($1) r', [u.auth])).r;
    assert.equal(prepared.eligible, true, JSON.stringify(prepared));
    assert.equal((await one('SELECT public.erase_account($1,$2) r', [u.auth, prepared.confirmation_token])).r.ok, true);
    assert.deepEqual((await one('SELECT payload FROM public.crun_dispatch WHERE job_id=$1', [job])).payload, {});
  }));

  it('projects Crun unknown, unobservable, and pending alerts into recovery health', async () => isolated(async () => {
    const u = await user();
    const unknown = await debit(u.id); await dispatch(unknown, 'READY');
    await client.query("UPDATE public.crun_dispatch SET state='UNKNOWN',resolved_at=clock_timestamp()-interval '11 minutes' WHERE job_id=$1", [unknown]);
    const accepted = await debit(u.id); await dispatch(accepted, 'READY');
    await client.query("UPDATE public.crun_dispatch SET state='ACCEPTED',provider_job_id='health-unobservable',resolved_at=clock_timestamp()-interval '46 minutes' WHERE job_id=$1", [accepted]);
    const pending = await debit(u.id); await dispatch(pending, 'READY');
    await client.query("UPDATE public.crun_dispatch SET state='ACCEPTED',provider_job_id='health-pending',resolved_at=clock_timestamp()-interval '46 minutes',last_authoritative_status='pending',last_authoritative_at=clock_timestamp() WHERE job_id=$1", [pending]);
    await one('SELECT public.refresh_recovery_health()');
    const summary = (await one('SELECT summary FROM public.recovery_health_snapshot WHERE singleton')).summary;
    assert.ok(Number(summary.crun_dispatch_unknown) >= 1);
    assert.ok(Number(summary.crun_dispatch_accepted_unobservable) >= 1);
    assert.ok(Number(summary.crun_dispatch_authoritative_pending) >= 1);
  }));

  it('keeps browser roles away from every new table and RPC', async () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one("SELECT has_table_privilege($1,'public.crun_taskinfo_reservations','SELECT') p", [role])).p, false);
      for (const signature of ['pause_crun_account_admission(text,timestamp with time zone)',
        'resume_crun_account_admission(bigint)', 'reserve_crun_taskinfo_slot(text,text)',
        'record_crun_task_status(uuid,text,timestamp with time zone)', 'crun_dispatch_health(integer)']) {
        assert.equal((await one('SELECT has_function_privilege($1,$2,\'EXECUTE\') p', [role, `public.${signature}`])).p, false);
      }
    }
  });
});
