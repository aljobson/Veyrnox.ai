/** Acceptance checks for migration 0586. Requires a disposable migrated local DB. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const url = process.env.CRUN_SUNO_MUSIC_TEST_DATABASE_URL || process.env.DATABASE_URL;
const local = (() => {
  if (!url) return false;
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname); } catch { return false; }
})();

describe('Crun Suno quote controls (0586)', { skip: !local && 'disposable localhost database not set' }, () => {
  let pool: any;
  let client: any;
  const one = async (sql: string, args: unknown[] = []) => (await client.query(sql, args)).rows[0];
  let seq = 0;
  const isolated = async (fn: () => Promise<void>) => {
    const name = `c0586_${seq += 1}`;
    await client.query(`SAVEPOINT ${name}`);
    try { await fn(); } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await client.query(`RELEASE SAVEPOINT ${name}`);
    }
  };
  const paidUser = async () => {
    const auth = randomUUID();
    const user = (await one('SELECT public.signup_grant($1,$2) id', [auth, `${auth}@0586.accept.test`])).id;
    const inserted = await client.query(`INSERT INTO public.credit_subscriptions
      (user_id,plan_id,idempotency_key,price_usd_cents,credits,consent_version,status,current_period_end)
      SELECT $1,id,$2,price_usd_cents,credits,'acceptance-v1','active',now()+interval '1 day'
      FROM public.credit_subscription_plans WHERE active ORDER BY id LIMIT 1`,
    [user, `0586.${randomUUID()}`]);
    assert.equal(inserted.rowCount, 1, 'a migrated paid plan must exist');
    return { auth, user: user as string };
  };

  before(async () => {
    const pg = (await import('pg')).default;
    pool = new pg.Pool({ connectionString: url, max: 2 });
    client = await pool.connect();
    await client.query("SET TIME ZONE 'UTC'");
    await client.query('BEGIN');
  });
  after(async () => {
    if (client) { await client.query('ROLLBACK'); client.release(); }
    if (pool) await pool.end();
  });

  it('freezes every contract-bound custom control on one prompt snapshot', async () => isolated(async () => {
    const { auth, user } = await paidUser();
    await client.query(`UPDATE public.model_catalog SET provider='crun',provider_endpoint='crun:suno/music-generate',
      credits_5s=4,provider_cost_per_unit=0.0536,updated_at=clock_timestamp() WHERE id='ace-step-1.5'`);
    const draft = await one(`INSERT INTO public.music_lyric_drafts
      (user_id,provider_contract,model_id,lyrics,styles,title)
      VALUES($1,'crun-suno-v1','ace-step-1.5','lyrics','tags','title') RETURNING id,revision`, [user]);
    const quoted = (await one(`SELECT public.music_create_custom_quote(
      $1,'crun-suno-v1',$2,$3,false,true,135,'v6_wild','female',75,0.625,88,repeat('x',1000)) r`,
    [auth, draft.id, draft.revision])).r;
    assert.equal(quoted.ok, true, JSON.stringify(quoted));
    assert.equal(quoted.total_credits, 8);
    assert.equal(Number(quoted.style_weight), 0.75);
    assert.equal(quoted.variety, 4);
    assert.equal(quoted.exclude_styles_applied_chars, 200);
    const frozen = await one(`SELECT p.* FROM public.music_prompt_specs p
      JOIN public.music_generation_quotes q ON q.prompt_spec_id=p.id WHERE q.id=$1`, [quoted.quote_id]);
    assert.deepEqual([
      frozen.provider_contract, frozen.suno_model, frozen.vocal_gender,
      Number(frozen.style_influence), Number(frozen.weirdness), Number(frozen.variety),
      frozen.exclude_styles.length, Number(frozen.duration_seconds),
    ], ['crun-suno-v1', 'v6_wild', 'female', 75, 0.625, 88, 1000, 135]);
  }));

  it('rejects stale contract identity without creating a quote', async () => isolated(async () => {
    const { auth, user } = await paidUser();
    const draft = await one(`INSERT INTO public.music_lyric_drafts
      (user_id,provider_contract,model_id,lyrics,styles)
      VALUES($1,'crun-suno-v1','ace-step-1.5','lyrics','tags') RETURNING id,revision`, [user]);
    const beforeCount = Number((await one('SELECT count(*) n FROM public.music_generation_quotes WHERE user_id=$1', [user])).n);
    const result = (await one(`SELECT public.music_create_custom_quote(
      $1,'crun-suno-v1',$2,$3,false,true,60,'v6','auto',NULL,NULL,NULL,NULL) r`,
    [auth, draft.id, draft.revision])).r;
    assert.equal(result.code, 'CONTRACT_STALE');
    assert.equal(Number((await one('SELECT count(*) n FROM public.music_generation_quotes WHERE user_id=$1', [user])).n), beforeCount);
  }));

  it('keeps the deployed fal custom signature callable', async () => isolated(async () => {
    const { auth, user } = await paidUser();
    await client.query(`INSERT INTO public.music_lyric_drafts
      (user_id,provider_contract,model_id,lyrics,styles)
      VALUES($1,'fal-ace-v1','ace-step-1.5','lyrics','tags')`, [user]);
    const result = (await one('SELECT public.music_create_custom_quote($1,0,false,true,60) r', [auth])).r;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.provider_contract, 'fal-ace-v1');
  }));

  it('projects account, endpoint and Suno-model breakers and refuses matching quotes', async () => isolated(async () => {
    const { auth } = await paidUser();
    const endpoint = 'crun:suno/music-generate';
    await client.query(`UPDATE public.model_catalog SET provider='crun',provider_endpoint=$1,
      credits_5s=4,provider_cost_per_unit=0.0536,updated_at=clock_timestamp() WHERE id='ace-step-1.5'`, [endpoint]);
    await client.query("UPDATE public.provider_spend_provider_policy SET admission_open=true WHERE provider='crun'");
    await client.query("UPDATE public.model_routes SET breaker_opened_at=NULL WHERE supplier='crun' AND endpoint=$1", [endpoint]);

    const call = (model: string) => one(`SELECT public.music_create_quote(
      $1,'breaker fixture',NULL,'ace-step-1.5',NULL,NULL,NULL,60,
      'crun-suno-v1',false,$2,'auto',NULL) r`, [auth, model]);
    const trip = (await one("SELECT public.trip_crun_suno_model_breaker($1,'v6_wild','acceptance_trip',clock_timestamp()) r", [endpoint])).r;
    assert.equal(trip.ok, true);
    let availability = (await one('SELECT public.music_get_crun_availability() r')).r;
    assert.equal(availability.suno_models.v6_wild, false);
    assert.equal(availability.suno_models.v6, true);
    assert.equal((await call('v6_wild')).r.code, 'MUSIC_UNAVAILABLE');
    assert.equal((await call('v6')).r.ok, true);

    await client.query("UPDATE public.model_routes SET breaker_opened_at=clock_timestamp() WHERE supplier='crun' AND endpoint=$1", [endpoint]);
    availability = (await one('SELECT public.music_get_crun_availability() r')).r;
    assert.equal(availability.endpoint_open, false);
    assert.equal((await call('v6')).r.code, 'MUSIC_UNAVAILABLE');

    await client.query("UPDATE public.model_routes SET breaker_opened_at=NULL WHERE supplier='crun' AND endpoint=$1", [endpoint]);
    await client.query("UPDATE public.provider_spend_provider_policy SET admission_open=false WHERE provider='crun'");
    availability = (await one('SELECT public.music_get_crun_availability() r')).r;
    assert.equal(availability.admission_open, false);
    assert.equal((await call('v6')).r.code, 'MUSIC_UNAVAILABLE');
  }));
});
