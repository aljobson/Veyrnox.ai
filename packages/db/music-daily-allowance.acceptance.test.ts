/** Acceptance checks for migration 0601. Disposable fully replayed local DB only. */
import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// This suite requires the fully replayed Crun/Music database. The broader
// ledger job also exposes DATABASE_URL, but that points at its lean fixture
// and intentionally lacks provider-spend and 0601 tables.
const url = process.env.CRUN_SUNO_MUSIC_TEST_DATABASE_URL;
const local = (() => {
  if (!url) return false;
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname); } catch { return false; }
})();

describe('Music daily allowance (0601)', { skip: !local && 'disposable localhost database not set' }, () => {
  let pool: any;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const user = async () => {
    const auth = randomUUID();
    const id = (await one('SELECT public.signup_grant($1,$2) id', [auth, `${randomUUID()}@daily.accept.test`])).id;
    return { auth, id: id as string };
  };
  const quote = async (auth: string, prompt: string) => (await one(`SELECT public.music_create_quote_with_daily_allowance(
    $1,$2,NULL,'ace-step',NULL,NULL,NULL,60,'crun-suno-v1',true,'v6','auto',NULL) r`, [auth, prompt])).r;

  before(async () => {
    const pg = (await import('pg')).default;
    pool = new pg.Pool({ connectionString: url, max: 4 });
    await pool.query('CREATE TABLE IF NOT EXISTS auth.mfa_factors(user_id uuid,factor_type text,status text)');
    await pool.query(`UPDATE public.model_catalog SET provider='crun',provider_endpoint='crun:suno/music-generate',
      credits_5s=4,provider_cost_per_unit=0.0536,active=true,updated_at=statement_timestamp() WHERE id='ace-step'`);
    await pool.query("UPDATE public.provider_spend_provider_policy SET admission_open=true WHERE provider='crun'");
  });
  beforeEach(async () => {
    await pool.query('UPDATE public.music_daily_allowance_policy SET enabled=true,candidates_per_user_per_day=10,global_candidates_per_day=100 WHERE singleton');
  });
  after(async () => {
    if (pool) {
      await pool.query('UPDATE public.music_daily_allowance_policy SET enabled=false WHERE singleton');
      await pool.end();
    }
  });

  it('supersedes re-quotes and admits a zero-balance-safe track atomically', async () => {
    const owner = await user();
    const oldQuote = await quote(owner.auth, 'first direction');
    const current = await quote(owner.auth, 'corrected direction');
    assert.equal(current.daily_free_candidates, 1);
    assert.equal(current.list_credits, 4);
    assert.equal(current.total_credits, 0);
    assert.equal(current.affordable, true);
    assert.equal(current.balance_after, current.balance);
    const stale = (await one('SELECT public.music_submit_pair($1,$2,$3) r',
      [owner.auth, oldQuote.quote_id, `daily.old.${randomUUID()}`])).r;
    assert.equal(stale.code, 'DAILY_ALLOWANCE_STALE');
    const madeKey = `daily.new.${randomUUID()}`;
    const made = (await one('SELECT public.music_submit_pair($1,$2,$3) r',
      [owner.auth, current.quote_id, madeKey])).r;
    assert.equal(made.ok, true);
    assert.equal(made.charged_credits, 0);
    assert.equal(made.daily_free_candidates, 1);
    assert.equal(Number((await one(`SELECT count(*) n FROM public.jobs j
      JOIN public.music_generation_candidates c ON c.job_id=j.id
      WHERE c.generation_request_id=$1 AND j.credits=0 AND j.free_allowance`, [made.request_id])).n), 1);
    assert.equal(Number((await one(`SELECT count(*) n FROM public.music_daily_allowance_claims
      WHERE quote_id=$1 AND state='TAKEN'`, [current.quote_id])).n), 1);
    await pool.query("UPDATE public.music_daily_allowance_reservations SET state='SUPERSEDED',consumed_at=NULL,superseded_at=now() WHERE quote_id=$1", [current.quote_id]);
    const orphaned = (await pool.query('SELECT * FROM public.reconcile_free_allowance()')).rows;
    assert.equal(orphaned.some((row: any) => row.kind === 'music_orphan_claim'
      && made.job_ids.includes(row.ref)), true);
    await pool.query("UPDATE public.music_daily_allowance_reservations SET state='CONSUMED',consumed_at=now(),superseded_at=NULL WHERE quote_id=$1", [current.quote_id]);
    const madeReplay = (await one('SELECT public.music_submit_pair($1,$2,$3) r',
      [owner.auth, current.quote_id, madeKey])).r;
    assert.equal(madeReplay.idempotent, true);
    assert.equal(Number((await one('SELECT count(*) n FROM public.music_generation_requests WHERE user_id=$1 AND idempotency_key=$2', [owner.id, madeKey])).n), 1);
    // A second quote also proves replay isolation when earlier claims exist.
    const requestKey = `daily.replay.${randomUUID()}`;
    const replayQuote = await quote(owner.auth, 'replay direction');
    const first = (await one('SELECT public.music_submit_pair($1,$2,$3) r', [owner.auth, replayQuote.quote_id, requestKey])).r;
    const again = (await one('SELECT public.music_submit_pair($1,$2,$3) r', [owner.auth, replayQuote.quote_id, requestKey])).r;
    assert.equal(first.ok, true); assert.equal(again.idempotent, true);
    assert.equal(Number((await one('SELECT count(*) n FROM public.music_generation_requests WHERE user_id=$1 AND idempotency_key=$2', [owner.id, requestKey])).n), 1);
    assert.equal(Number((await one('SELECT count(*) n FROM public.jobs WHERE user_id=$1 AND idempotency_key IN($2,$3)', [owner.id, `${requestKey}.1`, `${requestKey}.2`])).n), 1);
  });

  it('returns a failed one-track allowance slot exactly once', async () => {
    const owner = await user();
    const used = Number((await one(`SELECT coalesce(sum(candidates),0) n FROM (
      SELECT 1 candidates FROM public.music_daily_allowance_claims WHERE day=(now() AT TIME ZONE 'UTC')::date AND state='TAKEN'
      UNION ALL SELECT candidates FROM public.music_daily_allowance_reservations
        WHERE day=(now() AT TIME ZONE 'UTC')::date AND state='LIVE' AND expires_at>now()) x`)).n);
    await pool.query('UPDATE public.music_daily_allowance_policy SET global_candidates_per_day=$1 WHERE singleton', [used + 1]);
    const before = Number((await one(`SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END balance
      FROM public.credit_balances WHERE user_id=$1`, [owner.id])).balance);
    const priced = await quote(owner.auth, 'mixed direction');
    assert.equal(priced.daily_free_candidates, 1);
    assert.equal(priced.total_credits, 0);
    assert.equal(priced.balance_after, before);
    const made = (await one('SELECT public.music_submit_pair($1,$2,$3) r',
      [owner.auth, priced.quote_id, `daily.mix.${randomUUID()}`])).r;
    assert.equal(made.ok, true);
    const rows = (await pool.query(`SELECT j.id,j.free_allowance,j.credits FROM public.jobs j
      JOIN public.music_generation_candidates c ON c.job_id=j.id WHERE c.generation_request_id=$1 ORDER BY c.ordinal`,
    [made.request_id])).rows;
    assert.deepEqual(rows.map((row: any) => [row.free_allowance, Number(row.credits)]), [[true, 0]]);
    await pool.query("UPDATE public.crun_dispatch SET state='CLOSED' WHERE job_id=$1", [rows[0].id]);
    await pool.query("UPDATE public.jobs SET state='FAILED',updated_at=now()-interval '1 second' WHERE id=$1", [rows[0].id]);
    const unreconciled = (await pool.query('SELECT * FROM public.reconcile_free_allowance()')).rows;
    assert.equal(unreconciled.some((row: any) => row.kind === 'music_failed_unreturned' && row.ref === rows[0].id), true);
    await one('SELECT public.sweep_stuck_jobs(0,0,200,0) r');
    assert.equal((await one('SELECT state FROM public.music_daily_allowance_claims WHERE job_id=$1', [rows[0].id])).state, 'RETURNED');
    const replay = (await one("SELECT public.ledger_refund($1,$2,0,'refund:daily_acceptance') r", [rows[0].id, owner.id])).r;
    assert.equal(replay.idempotent, true);
    assert.equal(replay.allowance_returned, false);
    const drift = (await pool.query('SELECT * FROM public.reconcile_free_allowance()')).rows;
    assert.equal(drift.some((row: any) => rows.some((job: any) => String(row.ref).includes(job.id))), false);
  });

  it('serializes different users at the final global slot', async () => {
    const [left, right] = await Promise.all([user(), user()]);
    const used = Number((await one(`SELECT coalesce(sum(candidates),0) n FROM (
      SELECT 1 candidates FROM public.music_daily_allowance_claims WHERE day=(now() AT TIME ZONE 'UTC')::date AND state='TAKEN'
      UNION ALL SELECT candidates FROM public.music_daily_allowance_reservations
        WHERE day=(now() AT TIME ZONE 'UTC')::date AND state='LIVE' AND expires_at>now()) x`)).n);
    await pool.query('UPDATE public.music_daily_allowance_policy SET global_candidates_per_day=$1 WHERE singleton', [used + 1]);
    const [a, b] = await Promise.all([quote(left.auth, 'global left'), quote(right.auth, 'global right')]);
    assert.equal(Number(a.daily_free_candidates) + Number(b.daily_free_candidates), 1);
    assert.deepEqual([a.daily_free_candidates, b.daily_free_candidates].sort(), [0, 1]);
  });

  it('releases expired reservations and refuses policy or day drift before writes', async () => {
    const owner = await user();
    const expired = await quote(owner.auth, 'expiring direction');
    await pool.query("UPDATE public.music_daily_allowance_reservations SET expires_at=now()-interval '1 second' WHERE quote_id=$1", [expired.quote_id]);
    const replacement = await quote(owner.auth, 'replacement after expiry');
    assert.equal(replacement.daily_free_candidates, 1);
    const before = Number((await one('SELECT count(*) n FROM public.music_generation_requests WHERE user_id=$1', [owner.id])).n);
    await pool.query('UPDATE public.music_daily_allowance_policy SET enabled=false WHERE singleton');
    const stale = (await one('SELECT public.music_submit_pair($1,$2,$3) r', [owner.auth, replacement.quote_id, `daily.policy.${randomUUID()}`])).r;
    assert.equal(stale.code, 'DAILY_ALLOWANCE_STALE');
    assert.equal(Number((await one('SELECT count(*) n FROM public.music_generation_requests WHERE user_id=$1', [owner.id])).n), before);
    await pool.query('UPDATE public.music_daily_allowance_policy SET enabled=true WHERE singleton');
    await pool.query("UPDATE public.music_daily_allowance_reservations SET day=day-1 WHERE quote_id=$1", [replacement.quote_id]);
    const dayStale = (await one('SELECT public.music_submit_pair($1,$2,$3) r', [owner.auth, replacement.quote_id, `daily.day.${randomUUID()}`])).r;
    assert.equal(dayStale.code, 'DAILY_ALLOWANCE_STALE');
  });

  it('keeps only one live same-user quote and returns a cancelled free slot once', async () => {
    const owner = await user();
    const [a, b] = await Promise.all([quote(owner.auth, 'same user left'), quote(owner.auth, 'same user right')]);
    assert.equal(Number((await one(`SELECT count(*) n FROM public.music_daily_allowance_reservations
      WHERE user_id=$1 AND state='LIVE'`, [owner.id])).n), 1);
    const live = (await one(`SELECT quote_id FROM public.music_daily_allowance_reservations
      WHERE user_id=$1 AND state='LIVE'`, [owner.id])).quote_id;
    const staleId = a.quote_id === live ? b.quote_id : a.quote_id;
    assert.equal((await one('SELECT public.music_submit_pair($1,$2,$3) r', [owner.auth, staleId, `daily.same.${randomUUID()}`])).r.code, 'DAILY_ALLOWANCE_STALE');
    const made = (await one('SELECT public.music_submit_pair($1,$2,$3) r', [owner.auth, live, `daily.cancel.${randomUUID()}`])).r;
    const job = made.job_ids[0];
    assert.equal((await one('SELECT public.cancel_user_job($1,$2) r', [owner.auth, job])).r.ok, true);
    assert.equal((await one('SELECT state FROM public.music_daily_allowance_claims WHERE job_id=$1', [job])).state, 'RETURNED');
    assert.equal((await one('SELECT public.cancel_user_job($1,$2) r', [owner.auth, job])).r.replayed, true);
  });

  it('cancels a free track exactly once and projects its allowance refund truth', async () => {
    const owner = await user();
    const used = Number((await one(`SELECT coalesce(sum(candidates),0) n FROM (
      SELECT 1 candidates FROM public.music_daily_allowance_claims WHERE day=(now() AT TIME ZONE 'UTC')::date AND state='TAKEN'
      UNION ALL SELECT candidates FROM public.music_daily_allowance_reservations
        WHERE day=(now() AT TIME ZONE 'UTC')::date AND state='LIVE' AND expires_at>now()) x`)).n);
    await pool.query('UPDATE public.music_daily_allowance_policy SET global_candidates_per_day=$1 WHERE singleton', [used + 1]);
    const balanceBefore = Number((await one(`SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END balance
      FROM public.credit_balances WHERE user_id=$1`, [owner.id])).balance);
    const priced = await quote(owner.auth, 'mixed cancellation projection');
    assert.equal(priced.daily_free_candidates, 1); assert.equal(priced.total_credits, 0);
    const made = (await one('SELECT public.music_submit_pair($1,$2,$3) r',
      [owner.auth, priced.quote_id, `daily.cancel.mixed.${randomUUID()}`])).r;
    const jobs = (await pool.query(`SELECT j.id,j.free_allowance,j.credits FROM public.jobs j
      JOIN public.music_generation_candidates c ON c.job_id=j.id
      WHERE c.generation_request_id=$1 ORDER BY c.ordinal`, [made.request_id])).rows;
    assert.deepEqual(jobs.map((row: any) => [row.free_allowance, Number(row.credits)]), [[true, 0]]);
    const originalClaimDay = (await one('SELECT day FROM public.music_daily_allowance_claims WHERE job_id=$1', [jobs[0].id])).day;
    const first = await Promise.all(jobs.map((job: any) => one('SELECT public.cancel_user_job($1,$2) r', [owner.auth, job.id])));
    assert.deepEqual(first.map((row: any) => [row.r.ok, row.r.replayed, Number(row.r.credits)]), [[true, false, 0]]);
    const replay = await Promise.all(jobs.map((job: any) => one('SELECT public.cancel_user_job($1,$2) r', [owner.auth, job.id])));
    assert.deepEqual(replay.map((row: any) => [row.r.ok, row.r.replayed]), [[true, true]]);
    const returnedClaim = await one('SELECT state,day FROM public.music_daily_allowance_claims WHERE job_id=$1', [jobs[0].id]);
    assert.equal(returnedClaim.state, 'RETURNED'); assert.deepEqual(returnedClaim.day, originalClaimDay);
    assert.equal(Number((await one(`SELECT count(*) n FROM public.ledger_entries
      WHERE job_id=ANY($1::uuid[]) AND delta>0 AND reason='refund:user_cancelled'`, [jobs.map((job: any) => job.id)])).n), 0);
    assert.equal(Number((await one(`SELECT balance-CASE WHEN subscription_expires_at>now() THEN 0 ELSE subscription_balance END balance
      FROM public.credit_balances WHERE user_id=$1`, [owner.id])).balance), balanceBefore);
    const projected = (await one('SELECT public.music_get_generation($1,$2) r', [owner.auth, made.request_id])).r;
    assert.equal(projected.ok, true);
    assert.equal(projected.generation.state, 'refunded');
    assert.deepEqual(projected.generation.candidates.map((candidate: any) => [candidate.state, candidate.error_code, Number(candidate.credits)]),
      [['refunded', 'user_cancelled', 0]]);
  });

  it('fails closed for eligibility, provider pause and insufficient paid-track balance', async () => {
    const frozen = await user();
    await pool.query('UPDATE public.users SET frozen_at=now() WHERE id=$1', [frozen.id]);
    const frozenQuote = await quote(frozen.auth, 'frozen direction');
    assert.ok(frozenQuote.code === 'ACCOUNT_FROZEN' || frozenQuote.daily_free_candidates === 0);
    const owner = await user();
    const pausedQuote = await quote(owner.auth, 'paused direction');
    await pool.query("UPDATE public.provider_spend_provider_policy SET admission_open=false WHERE provider='crun'");
    assert.equal((await one('SELECT public.music_submit_pair($1,$2,$3) r', [owner.auth, pausedQuote.quote_id, `daily.pause.${randomUUID()}`])).r.code, 'MUSIC_UNAVAILABLE');
    await pool.query("UPDATE public.provider_spend_provider_policy SET admission_open=true WHERE provider='crun'");
    await pool.query('UPDATE public.music_daily_allowance_policy SET enabled=false WHERE singleton');
    const paid = await quote(owner.auth, 'unaffordable paid direction');
    assert.equal(paid.daily_free_candidates, 0);
    assert.equal(paid.total_credits, 4);
    await pool.query('UPDATE public.credit_balances SET balance=0,free_balance=0,subscription_balance=0 WHERE user_id=$1', [owner.id]);
    assert.equal((await one('SELECT public.music_submit_pair($1,$2,$3) r', [owner.auth, paid.quote_id, `daily.broke.${randomUUID()}`])).r.code, 'INSUFFICIENT_BALANCE');
  });

  it('exports policy, reservations and claims then anonymizes claims without releasing budget', async () => {
    const owner = await user();
    const priced = await quote(owner.auth, 'privacy direction');
    const made = (await one('SELECT public.music_submit_pair($1,$2,$3) r', [owner.auth, priced.quote_id, `daily.privacy.${randomUUID()}`])).r;
    const request = await one(`INSERT INTO public.privacy_export_requests(user_id,as_of,expires_at,aal)
      VALUES($1,now()+interval '1 second',now()+interval '1 hour','aal1') RETURNING id`, [owner.id]);
    const exported = (await one(`SELECT public.read_music_daily_allowance_export_page($1,'aal1',$2,NULL,NULL,200) r`, [owner.auth, request.id])).r;
    assert.equal(exported.ok, true);
    assert.deepEqual(new Set(exported.rows.map((row: any) => row.kind)), new Set(['policy', 'reservation', 'claim']));
    const before = Number((await one("SELECT count(*) n FROM public.music_daily_allowance_claims WHERE state='TAKEN'")).n);
    await pool.query('UPDATE public.jobs SET state=\'REFUNDED\' WHERE id=ANY($1::uuid[])', [made.job_ids]);
    await pool.query('UPDATE public.users SET deleted_at=now() WHERE id=$1', [owner.id]);
    assert.equal(Number((await one('SELECT count(*) n FROM public.music_daily_allowance_reservations WHERE user_id=$1', [owner.id])).n), 0);
    assert.equal(Number((await one('SELECT count(*) n FROM public.music_daily_allowance_claims WHERE quote_id=$1 AND user_id IS NULL', [priced.quote_id])).n), 1);
    assert.equal(Number((await one("SELECT count(*) n FROM public.music_daily_allowance_claims WHERE state='TAKEN'")).n), before);
  });

  it('keeps the route-facing named RPC signatures unambiguous', async () => {
    const rows = (await pool.query(`SELECT p.proname,pg_get_function_arguments(p.oid) args FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
      AND p.proname IN('music_create_quote_with_daily_allowance','music_create_custom_quote_with_daily_allowance')`)).rows;
    assert.equal(rows.length, 2);
    assert.match(rows.find((row: any) => row.proname === 'music_create_quote_with_daily_allowance').args, /p_auth_id text.*p_weirdness numeric/);
    assert.match(rows.find((row: any) => row.proname === 'music_create_custom_quote_with_daily_allowance').args, /p_auth_id text.*p_exclude_styles text/);
  });
});
