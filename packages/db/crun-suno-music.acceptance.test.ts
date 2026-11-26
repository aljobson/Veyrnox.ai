/** Acceptance checks for migration 0591. Requires a disposable migrated local DB. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const url = process.env.CRUN_SUNO_MUSIC_TEST_DATABASE_URL || process.env.DATABASE_URL;
const local = (() => {
  if (!url) return false;
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(url).hostname); } catch { return false; }
})();

describe('Crun Suno music foundation (0591)', { skip: !local && 'disposable localhost database not set' }, () => {
  let pool: any;
  let client: any;
  const one = async (sql: string, args: unknown[] = []) => (await client.query(sql, args)).rows[0];
  const debit = async (kind = 'music') => {
    const auth = randomUUID();
    const user = (await one('SELECT public.signup_grant($1,$2) id', [auth, `${randomUUID()}@crun.accept.test`])).id;
    const result = (await one(`SELECT public.ledger_debit($1,$2,1,'debit:generation','ace-step',$3::jsonb) r`,
      [user, `crun.${randomUUID()}`, JSON.stringify({ kind })])).r;
    assert.equal(result.ok, true);
    return { user, job: result.job_id as string };
  };
  let savepointSeq = 0;
  // Runs fn inside a savepoint that is always rolled back, so a failure cannot abort the shared transaction.
  const isolated = async (fn: () => Promise<void>) => {
    const name = `crun_t_${savepointSeq += 1}`;
    await client.query(`SAVEPOINT ${name}`);
    try { await fn(); } finally {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await client.query(`RELEASE SAVEPOINT ${name}`);
    }
  };
  const mkUser = async () => {
    const auth = randomUUID();
    const user = (await one('SELECT public.signup_grant($1,$2) id', [auth, `${randomUUID()}@crun.accept.test`])).id;
    return { auth, user: user as string };
  };
  const debitFor = async (user: string, kind = 'music') => {
    const result = (await one(`SELECT public.ledger_debit($1,$2,1,'debit:generation','ace-step',$3::jsonb) r`,
      [user, `crun.${randomUUID()}`, JSON.stringify({ kind })])).r;
    assert.equal(result.ok, true);
    return result.job_id as string;
  };
  const refunds = async (job: string) => Number((await one('SELECT count(*) n FROM public.ledger_entries WHERE job_id=$1 AND delta>0', [job])).n);
  // A finished song whose prompt spec carries the given contract and text sizes (rows inserted directly).
  const makeSong = async (user: string, contract: 'crun-suno-v1' | 'fal-ace-v1', lyricsLen: number, stylesLen: number) => {
    const endpoint = contract === 'crun-suno-v1' ? 'crun:suno/music-generate' : 'fal-ai/ace-step-1.5';
    const spec = (await one(`INSERT INTO public.music_prompt_specs(user_id,mode,model_id,title,prompt,instrumental,schema_version,
        lyrics,styles,draft_revision,lyrics_rights_version,duration_seconds,provider_contract,suno_model)
      VALUES($1,'custom','ace-step-1.5','Fixture','fixture prompt',false,'music-custom-v1',repeat('l',$2::int),repeat('s',$3::int),0,
        'music-lyrics-rights-v1',60,$4,$5) RETURNING id`, [user, lyricsLen, stylesLen, contract, contract === 'crun-suno-v1' ? 'v6' : null])).id;
    const quote = (await one(`INSERT INTO public.music_generation_quotes(user_id,prompt_spec_id,model_id,provider_endpoint,unit_credits,total_credits,
        catalog_updated_at,expires_at) VALUES($1,$2,'ace-step-1.5',$3,3,6,now(),now()+interval '5 minutes') RETURNING id`, [user, spec, endpoint])).id;
    const request = (await one(`INSERT INTO public.music_generation_requests(user_id,quote_id,prompt_spec_id,model_id,idempotency_key,credit_quote)
      VALUES($1,$2,$3,'ace-step-1.5',$4,6) RETURNING id`, [user, quote, spec, `fixture.${randomUUID()}`])).id;
    const job = await debitFor(user);
    const asset = (await one(`INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes) VALUES($1,$2,'audio/mpeg',1000) RETURNING id`,
      [job, `fixture/${randomUUID()}`])).id;
    const song = (await one('INSERT INTO public.music_songs(user_id,title) VALUES($1,$2) RETURNING id', [user, 'Fixture song'])).id;
    const version = (await one(`INSERT INTO public.music_song_versions(user_id,song_id,generation_request_id,job_id,audio_asset_id)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [user, song, request, job, asset])).id;
    await client.query('UPDATE public.music_songs SET current_version_id=$2 WHERE id=$1', [song, version]);
    return { spec: spec as string, quote: quote as string, song: song as string, version: version as string };
  };
  const payload = { model: 'suno/music-generate', input: { mode: 'simple', prompt: 'acceptance', instrumental: true, suno_model: 'v6' } };

  before(async () => {
    const pg = (await import('pg')).default;
    pool = new pg.Pool({ connectionString: url, max: 4 });
    // 0611 unlists ACE after live provider SLA failures. This database is disposable, and the
    // committed fixture must be visible to the suite's dedicated concurrency connections.
    await pool.query("UPDATE public.model_catalog SET active=true WHERE id IN ('ace-step','ace-step-1.5')");
    client = await pool.connect();
    await client.query("SET TIME ZONE 'UTC'");
    await client.query('BEGIN');
  });
  after(async () => {
    if (client) { await client.query('ROLLBACK'); client.release(); }
    if (pool) await pool.end();
  });

  it('ships one verified active route while the unproven 1.5 route stays on standby', async () => {
    const rows = (await client.query(`SELECT model_id,state,provenance,parity_record,cost_per_unit
      FROM public.model_routes WHERE supplier='crun' AND endpoint='crun:suno/music-generate' ORDER BY model_id`)).rows;
    assert.deepEqual(rows.map((r: any) => r.model_id), ['ace-step', 'ace-step-1.5']);
    assert.equal(rows[0].state, 'active');
    assert.equal(rows[0].provenance, 'licensed_reseller');
    assert.ok(rows[0].parity_record);
    assert.equal(rows[1].state, 'standby');
    assert.equal(rows[1].provenance, 'unverified');
    assert.equal(rows[1].parity_record, null);
    assert.ok(rows.every((r: any) => Number(r.cost_per_unit) === 0.0536));
  });

  it('re-running the whole 0591 file keeps routes the owner made active and verified', async () => {
    const file = (await readFile(new URL('./schema/supabase/0591_crun_suno_music_foundation.sql', import.meta.url), 'utf8'))
      .replace(/^BEGIN;\s*$/m, '').replace(/^COMMIT;\s*$/m, '');
    assert.ok(!/^\s*(BEGIN|COMMIT);/m.test(file), 'transaction control left in the replayed file');
    await isolated(async () => {
      await client.query(`UPDATE public.model_routes SET state='active',provenance='licensed_reseller',
        parity_record='acceptance parity record',cost_per_unit=0.07,priority=7
        WHERE supplier='crun' AND endpoint='crun:suno/music-generate'`);
      const read = async () => (await client.query(`SELECT model_id,state,provenance,parity_record,cost_per_unit::text,priority,billing_seconds
        FROM public.model_routes WHERE supplier='crun' AND endpoint='crun:suno/music-generate' ORDER BY model_id`)).rows;
      const before = await read();
      assert.equal(before.length, 2);
      await client.query(file);
      await client.query(file);
      assert.deepEqual(await read(), before);
    });
  });

  // These pool-based concurrency cases must run before shared-transaction tests
  // retain provider, route, or allowance locks until the suite-level rollback.
  it('serializes simultaneous single-track submissions and rejects key reuse for another quote', { timeout: 15_000 }, async () => {
    const auth = randomUUID();
    const email = `${randomUUID()}@pair.accept.test`;
    await pool.query('SELECT public.signup_grant($1,$2)', [auth, email]);
    const quote = (await pool.query("SELECT public.music_create_quote($1,'pair race',NULL,'ace-step') r", [auth])).rows[0].r;
    assert.equal(quote.ok, true);
    const key = `pair.${randomUUID()}`;
    const [left, right] = await Promise.all([
      pool.query('SELECT public.music_submit_pair($1,$2,$3) r', [auth, quote.quote_id, key]),
      pool.query('SELECT public.music_submit_pair($1,$2,$3) r', [auth, quote.quote_id, key]),
    ]);
    assert.equal(left.rows[0].r.ok, true);
    assert.equal(right.rows[0].r.ok, true);
    assert.deepEqual(left.rows[0].r.job_ids, right.rows[0].r.job_ids);
    assert.equal(left.rows[0].r.job_ids.length, 1);
    assert.equal([left.rows[0].r.idempotent, right.rows[0].r.idempotent].filter(Boolean).length, 1);
    const other = (await pool.query("SELECT public.music_create_quote($1,'different quote',NULL,'ace-step') r", [auth])).rows[0].r;
    const conflict = (await pool.query('SELECT public.music_submit_pair($1,$2,$3) r', [auth, other.quote_id, key])).rows[0].r;
    assert.equal(conflict.code, 'IDEMPOTENCY_CONFLICT');
  });

  it('lets one of two concurrent submits with different keys through when the user already has three active requests', { timeout: 15_000 }, async () => {
    const auth = randomUUID();
    const user = (await pool.query('SELECT public.signup_grant($1,$2) id', [auth, `${randomUUID()}@limit.accept.test`])).rows[0].id;
    const quote = async () => {
      const q = (await pool.query("SELECT public.music_create_quote($1,'limit race',NULL,'ace-step') r", [auth])).rows[0].r;
      assert.equal(q.ok, true);
      return q;
    };
    for (let i = 0; i < 3; i += 1) {
      const q = await quote();
      const spec = (await pool.query('SELECT prompt_spec_id FROM public.music_generation_quotes WHERE id=$1', [q.quote_id])).rows[0].prompt_spec_id;
      await pool.query(`INSERT INTO public.music_generation_requests(user_id,quote_id,prompt_spec_id,model_id,idempotency_key,credit_quote,status)
        VALUES($1,$2,$3,'ace-step',$4,$5,'debited')`, [user, q.quote_id, spec, `active.${randomUUID()}`, q.total_credits]);
    }
    const [qa, qb] = [await quote(), await quote()];
    const [a, b] = await Promise.all([
      pool.query('SELECT public.music_submit_pair($1,$2,$3) r', [auth, qa.quote_id, `limit.a.${randomUUID()}`]),
      pool.query('SELECT public.music_submit_pair($1,$2,$3) r', [auth, qb.quote_id, `limit.b.${randomUUID()}`]),
    ]);
    const results = [a.rows[0].r, b.rows[0].r];
    assert.equal(results.filter((r: any) => r.ok === true).length, 1, JSON.stringify(results));
    const rejected = results.find((r: any) => r.ok !== true);
    assert.equal(rejected.code, 'CONCURRENCY_LIMIT', JSON.stringify(results));
    assert.equal(Number((await pool.query(`SELECT count(*) n FROM public.music_generation_requests WHERE user_id=$1 AND status IN ('debited','running')`,
      [user])).rows[0].n), 4);
  });

  it('enforces twenty CreateTask reservations in every rolling ten seconds', async () => {
    await client.query('DELETE FROM public.crun_create_reservations');
    for (let i = 0; i < 20; i += 1) {
      const r = (await one('SELECT public.reserve_crun_create_slot($1,$2) r', [`accept.${i}.${randomUUID()}`, 'acceptance'])).r;
      assert.equal(r.ok, true);
    }
    const blocked = (await one('SELECT public.reserve_crun_create_slot($1,$2) r', [`accept.block.${randomUUID()}`, 'acceptance'])).r;
    assert.equal(blocked.code, 'CRUN_RATE_LIMITED');
    await client.query("UPDATE public.crun_create_reservations SET reserved_at=reserved_at-interval '10.001 seconds'");
    const edge = (await one('SELECT public.reserve_crun_create_slot($1,$2) r', [`accept.edge.${randomUUID()}`, 'acceptance'])).r;
    assert.equal(edge.ok, true);
  });

  it('counts the just-before edge and releases the just-after edge', async () => {
    await client.query('DELETE FROM public.crun_create_reservations');
    await client.query(`INSERT INTO public.crun_create_reservations(reservation_key,purpose,reserved_at)
      SELECT 'edge.'||g||'.'||$1,'acceptance',clock_timestamp()-interval '9 seconds' FROM generate_series(1,20) g`, [randomUUID()]);
    const before = (await one('SELECT public.reserve_crun_create_slot($1,$2) r', [`before.${randomUUID()}`, 'acceptance'])).r;
    assert.equal(before.code, 'CRUN_RATE_LIMITED');
    await client.query("UPDATE public.crun_create_reservations SET reserved_at=clock_timestamp()-interval '10.001 seconds'");
    const afterEdge = (await one('SELECT public.reserve_crun_create_slot($1,$2) r', [`after.${randomUUID()}`, 'acceptance'])).r;
    assert.equal(afterEdge.ok, true);
  });

  it('refuses a generic-path reservation while the shared Crun account circuit is paused', async () => isolated(async () => {
    await client.query('DELETE FROM public.crun_create_reservations');
    await client.query("UPDATE public.provider_spend_provider_policy SET admission_open=false WHERE provider='crun'");
    const key = `generic.paused.${randomUUID()}`;
    const blocked = (await one(`SELECT public.reserve_crun_create_slot($1,'generic.create',
      'crun:google/veo3-1-lite-t2v',NULL) r`, [key])).r;
    assert.equal(blocked.code, 'PROVIDER_ADMISSION_PAUSED');
    assert.equal(Number((await one('SELECT count(*) n FROM public.crun_create_reservations WHERE reservation_key=$1', [key])).n), 0);
  }));

  it('keeps fal and Crun drafts side by side under the composite key', async () => {
    const auth = randomUUID();
    const user = (await one('SELECT public.signup_grant($1,$2) id', [auth, `${auth}@accept.test`])).id;
    await client.query(`INSERT INTO public.music_lyric_drafts(user_id,provider_contract,model_id,lyrics,styles)
      VALUES($1,'fal-ace-v1','ace-step-1.5','fal lyric','fal style'),
            ($1,'crun-suno-v1','ace-step-1.5','crun lyric','crun style')`, [user]);
    assert.equal(Number((await one('SELECT count(*) n FROM public.music_lyric_drafts WHERE user_id=$1', [user])).n), 2);
  });

  it('keeps Crun duration pricing flat while fal retains blocks', async () => {
    assert.equal((await one("SELECT private.music_duration_price_blocks('ace-step-1.5','crun-suno-v1',135) n")).n, 1);
    assert.equal((await one("SELECT private.music_duration_price_blocks('ace-step-1.5','fal-ace-v1',135) n")).n, 3);
  });

  it('moves a stale STARTED dispatch to held UNKNOWN and reconciles its refund exactly once', async () => {
    const { user, job } = await debit();
    const token = randomUUID();
    await client.query(`INSERT INTO public.crun_dispatch(job_id,endpoint,payload,state,attempt_token,started_at)
      VALUES($1,'crun:suno/music-generate',$2,'STARTED',$3,clock_timestamp()-interval '3 minutes')`, [job, payload, token]);
    assert.equal((await one('SELECT public.recover_crun_dispatch() r')).r.ok, true);
    assert.equal((await one('SELECT state FROM public.crun_dispatch WHERE job_id=$1', [job])).state, 'UNKNOWN');
    await client.query("UPDATE public.jobs SET updated_at=clock_timestamp()-interval '4 hours' WHERE id=$1", [job]);
    await one('SELECT public.sweep_stuck_jobs(0,0,200,0) r');
    assert.equal((await one('SELECT state FROM public.jobs WHERE id=$1', [job])).state, 'DEBITED');
    await client.query("UPDATE public.crun_dispatch SET resolved_at=clock_timestamp()-interval '11 minutes' WHERE job_id=$1", [job]);
    const first = (await one("SELECT public.reconcile_crun_dispatch_unknown($1,$2,'REJECTED',NULL) r", [job, token])).r;
    const replay = (await one("SELECT public.reconcile_crun_dispatch_unknown($1,$2,'REJECTED',NULL) r", [job, token])).r;
    assert.equal(first.ok, true);
    assert.equal(replay.idempotent, true);
    assert.equal(Number((await one('SELECT count(*) n FROM public.ledger_entries WHERE job_id=$1 AND delta>0', [job])).n), 1);
    assert.equal((await one('SELECT user_id FROM public.jobs WHERE id=$1', [job])).user_id, user);
  });

  it('holds aged DEFERRED and projected ACCEPTED jobs out of the generic sweep', async () => {
    const deferred = await debit();
    await client.query(`INSERT INTO public.crun_dispatch(job_id,endpoint,payload,state,attempt_count,retry_at,created_at)
      VALUES($1,'crun:suno/music-generate',$2,'DEFERRED',5,clock_timestamp()-interval '1 minute',clock_timestamp()-interval '21 minutes')`, [deferred.job, payload]);
    await client.query("UPDATE public.jobs SET updated_at=clock_timestamp()-interval '4 hours' WHERE id=$1", [deferred.job]);
    await one('SELECT public.sweep_stuck_jobs(0,0,200,0) r');
    assert.equal((await one('SELECT state FROM public.jobs WHERE id=$1', [deferred.job])).state, 'DEBITED');
    await one('SELECT public.recover_crun_dispatch() r');
    assert.equal((await one('SELECT state FROM public.jobs WHERE id=$1', [deferred.job])).state, 'REFUNDED');
    const terminal = await one('SELECT state,attempt_count,failure_code FROM public.crun_dispatch WHERE job_id=$1', [deferred.job]);
    assert.deepEqual([terminal.state, Number(terminal.attempt_count), terminal.failure_code], ['CLOSED', 5, 'supplier_busy']);

    const accepted = await debit();
    await client.query(`INSERT INTO public.crun_dispatch(job_id,endpoint,payload,state,provider_job_id,resolved_at,projected_at)
      VALUES($1,'crun:suno/music-generate',$2,'ACCEPTED','accepted-task',clock_timestamp(),clock_timestamp())`, [accepted.job, payload]);
    assert.equal((await one("SELECT public.job_submitted($1,'crun','accepted-task') r", [accepted.job])).r.ok, true);
    await client.query("UPDATE public.jobs SET updated_at=clock_timestamp()-interval '4 hours' WHERE id=$1", [accepted.job]);
    await one('SELECT public.sweep_stuck_jobs(0,0,200,0) r');
    assert.equal((await one('SELECT state FROM public.jobs WHERE id=$1', [accepted.job])).state, 'SUBMITTED');
  });

  it('replays cleared-token DEFERRED and READY outcomes idempotently', async () => isolated(async () => {
    for (const outcome of ['DEFERRED', 'READY'] as const) {
      const { job } = await debit();
      const token = randomUUID();
      await client.query(`INSERT INTO public.crun_dispatch(job_id,endpoint,payload,state,attempt_token,started_at)
        VALUES($1,'crun:suno/music-generate',$2,'STARTED',$3,clock_timestamp())`, [job, payload, token]);
      const args = outcome === 'DEFERRED'
        ? [job, token, outcome, null, 'provider_rate_limited', 30]
        : [job, token, outcome, null, 'provider_auth_failed', null];
      const first = (await one('SELECT public.record_crun_dispatch($1,$2,$3,$4,$5,$6) r', args)).r;
      const before = await one('SELECT state,attempt_token,attempt_count,retry_at FROM public.crun_dispatch WHERE job_id=$1', [job]);
      const replay = (await one('SELECT public.record_crun_dispatch($1,$2,$3,$4,$5,$6) r', args)).r;
      const after = await one('SELECT state,attempt_token,attempt_count,retry_at FROM public.crun_dispatch WHERE job_id=$1', [job]);
      assert.equal(first.ok, true);
      assert.equal(replay.idempotent, true);
      assert.equal(before.attempt_token, null);
      assert.deepEqual(after, before);
      assert.equal(Number(after.attempt_count), outcome === 'DEFERRED' ? 1 : 0);
    }
  }));

  it('refunds authoritative task failure once and preserves speech-analysis sweep ownership', async () => {
    const failed = await debit();
    await client.query(`INSERT INTO public.crun_dispatch(job_id,endpoint,payload,state,provider_job_id,resolved_at,projected_at)
      VALUES($1,'crun:suno/music-generate',$2,'ACCEPTED','failed-task',clock_timestamp(),clock_timestamp())`, [failed.job, payload]);
    assert.equal((await one("SELECT public.job_submitted($1,'crun','failed-task') r", [failed.job])).r.ok, true);
    assert.equal((await one("SELECT public.record_crun_task_failure($1,'failed-task','provider_task_failed') r", [failed.job])).r.ok, true);
    assert.equal((await one("SELECT public.record_crun_task_failure($1,'failed-task','provider_task_failed') r", [failed.job])).r.idempotent, true);
    assert.equal(Number((await one('SELECT count(*) n FROM public.ledger_entries WHERE job_id=$1 AND delta>0', [failed.job])).n), 1);

    const speech = await debit('speech_analysis');
    await client.query("UPDATE public.jobs SET updated_at=clock_timestamp()-interval '4 hours' WHERE id=$1", [speech.job]);
    await one('SELECT public.sweep_stuck_jobs(0,0,200,0) r');
    assert.equal((await one('SELECT state FROM public.jobs WHERE id=$1', [speech.job])).state, 'DEBITED');
  });

  it('creates the Crun track atomically, freezes its adapter-compatible payload, and admits before debit', async () => {
    await client.query('SAVEPOINT crun_pair_branch');
    try {
      const auth = randomUUID();
      await one('SELECT public.signup_grant($1,$2) id', [auth, `${randomUUID()}@crun-pair.accept.test`]);
      await client.query(`UPDATE public.model_catalog SET provider='crun',provider_endpoint='crun:suno/music-generate',
        credits_5s=4,provider_cost_per_unit=0.0536,updated_at=clock_timestamp() WHERE id='ace-step'`);
      await client.query("UPDATE public.provider_spend_provider_policy SET admission_open=true WHERE provider='crun'");
      const quote = (await one("SELECT public.music_create_quote($1,'crun pair',NULL,'ace-step') r", [auth])).r;
      assert.equal(quote.ok, true);
      await client.query("UPDATE public.provider_spend_provider_policy SET admission_open=false WHERE provider='crun'");
      const held = (await one('SELECT public.music_submit_pair($1,$2,$3) r', [auth, quote.quote_id, `held.${randomUUID()}`])).r;
      assert.equal(held.code, 'MUSIC_UNAVAILABLE');
      await client.query("UPDATE public.provider_spend_provider_policy SET admission_open=true WHERE provider='crun'");
      const submitted = (await one('SELECT public.music_submit_pair($1,$2,$3) r', [auth, quote.quote_id, `sent.${randomUUID()}`])).r;
      assert.equal(submitted.ok, true);
      const rows = (await client.query(`SELECT d.payload FROM public.crun_dispatch d
        JOIN public.music_generation_candidates c ON c.job_id=d.job_id
        WHERE c.generation_request_id=$1 ORDER BY c.ordinal`, [submitted.request_id])).rows;
      assert.equal(rows.length, 1);
      assert.ok(rows.every((row: any) => row.payload.input.suno_model === 'v6' && row.payload.input.model === undefined));
      assert.equal(Number((await one(`SELECT count(*) n FROM public.fal_dispatch d
        JOIN public.music_generation_candidates c ON c.job_id=d.job_id WHERE c.generation_request_id=$1`, [submitted.request_id])).n), 0);
    } finally {
      await client.query('ROLLBACK TO SAVEPOINT crun_pair_branch');
      await client.query('RELEASE SAVEPOINT crun_pair_branch');
    }
  });

  it('gives a legacy direct draft insert without a contract the fal contract', async () => {
    await isolated(async () => {
      const { user } = await mkUser();
      const row = await one(`INSERT INTO public.music_lyric_drafts(user_id,model_id,lyrics,title) VALUES($1,'ace-step-1.5','legacy lyric','legacy') RETURNING provider_contract`, [user]);
      assert.equal(row.provider_contract, 'fal-ace-v1');
    });
  });

  it('refuses to reuse an over-limit Crun song into a fal draft without a CHECK violation', async () => {
    await isolated(async () => {
      const { auth, user } = await mkUser();
      const big = await makeSong(user, 'crun-suno-v1', 5000, 1000);
      assert.equal((await one('SELECT private.music_active_provider_contract($1) c', ['ace-step-1.5'])).c, 'fal-ace-v1');
      const ctx = (await one('SELECT public.music_get_reuse_draft_context($1,$2,$3) r', [auth, big.song, big.version])).r;
      assert.equal(ctx.code, 'REUSE_UNAVAILABLE');
      const ctxBound = (await one('SELECT public.music_get_reuse_draft_context($1,$2,$3,$4) r', [auth, big.song, big.version, 'fal-ace-v1'])).r;
      assert.equal(ctxBound.code, 'REUSE_UNAVAILABLE');
      for (const [lyrics, styles] of [[true, true], [true, false], [false, true]]) {
        const applied = (await one('SELECT public.music_apply_reuse_to_draft($1,$2,$3,0,$4,$5,$6) r',
          [auth, big.song, big.version, lyrics, styles, `reuse.${randomUUID()}`])).r;
        assert.equal(applied.code, 'REUSE_UNAVAILABLE', `lyrics=${lyrics} styles=${styles}`);
      }
      assert.equal(Number((await one('SELECT count(*) n FROM public.music_lyric_drafts WHERE user_id=$1', [user])).n), 0);
      // Control: a song inside the fal limits is reusable.
      const small = await makeSong(user, 'fal-ace-v1', 2900, 400);
      const ok = (await one('SELECT public.music_apply_reuse_to_draft($1,$2,$3,0,true,true,$4) r',
        [auth, small.song, small.version, `reuse.${randomUUID()}`])).r;
      assert.equal(ok.ok, true, JSON.stringify(ok).slice(0, 300));
    });
  });

  it('keeps a reopened model breaker as a tombstone that rejects stale trips and is ignored by claim', async () => {
    await isolated(async () => {
      const endpoint = 'crun:suno/music-generate';
      await client.query("UPDATE public.provider_spend_provider_policy SET admission_open=true WHERE provider='crun'");
      await client.query("UPDATE public.model_routes SET breaker_opened_at=NULL WHERE supplier='crun' AND endpoint=$1", [endpoint]);
      const { user } = await mkUser();
      const job = await debitFor(user);
      const wild = { model: 'suno/music-generate', input: { mode: 'simple', prompt: 'wild', instrumental: true, suno_model: 'v6_wild' } };
      await client.query(`INSERT INTO public.crun_dispatch(job_id,endpoint,payload) VALUES($1,$2,$3)`, [job, endpoint, wild]);
      const trip = (await one("SELECT public.trip_crun_suno_model_breaker($1,'v6_wild','acceptance_trip',clock_timestamp()) r", [endpoint])).r;
      assert.equal(trip.ok, true);
      const held = (await one('SELECT public.claim_crun_dispatch($1) r', [job])).r;
      assert.equal(held.held, true);
      assert.equal((await one('SELECT public.claim_crun_dispatch() r')).r, null);
      assert.equal((await one("SELECT public.reopen_crun_suno_model_breaker($1,'v6_wild',$2) r", [endpoint, trip.fence])).r.ok, true);
      const row = await one("SELECT is_open,reopened_at FROM public.crun_suno_model_breakers WHERE endpoint=$1 AND suno_model='v6_wild'", [endpoint]);
      assert.equal(row.is_open, false);
      assert.ok(row.reopened_at);
      const stale = (await one("SELECT public.trip_crun_suno_model_breaker($1,'v6_wild','late_trip',$2) r", [endpoint, row.reopened_at])).r;
      assert.equal(stale.code, 'STALE_FENCE');
      const before = (await one("SELECT public.trip_crun_suno_model_breaker($1,'v6_wild','older_trip',$2::timestamptz-interval '1 minute') r", [endpoint, row.reopened_at])).r;
      assert.equal(before.code, 'STALE_FENCE');
      assert.equal((await one("SELECT is_open FROM public.crun_suno_model_breakers WHERE endpoint=$1 AND suno_model='v6_wild'", [endpoint])).is_open, false);
      const claimed = (await one('SELECT public.claim_crun_dispatch($1) r', [job])).r;
      assert.ok(claimed && claimed.attempt_token, 'a reopened breaker must not hold the claim');
      await client.query("UPDATE public.crun_dispatch SET state='READY',attempt_token=NULL,started_at=NULL WHERE job_id=$1", [job]);
      const later = (await one("SELECT public.trip_crun_suno_model_breaker($1,'v6_wild','fresh_trip',$2::timestamptz+interval '1 second') r", [endpoint, row.reopened_at])).r;
      assert.equal(later.ok, true);
      assert.ok(Number(later.fence) > Number(trip.fence));
      assert.equal((await one('SELECT public.claim_crun_dispatch($1) r', [job])).r.held, true);
    });
  });

  it('projects a late ACCEPTED outcome for an UNKNOWN dispatch and clears the unknown error code', async () => {
    await isolated(async () => {
      const { user } = await mkUser();
      const job = await debitFor(user);
      const token = randomUUID();
      await client.query(`INSERT INTO public.crun_dispatch(job_id,endpoint,payload,state,attempt_token,started_at)
        VALUES($1,'crun:suno/music-generate',$2,'STARTED',$3,clock_timestamp()-interval '3 minutes')`, [job, payload, token]);
      assert.equal((await one('SELECT public.recover_crun_dispatch() r')).r.ok, true);
      assert.equal((await one('SELECT state FROM public.crun_dispatch WHERE job_id=$1', [job])).state, 'UNKNOWN');
      assert.equal((await one('SELECT error_code FROM public.jobs WHERE id=$1', [job])).error_code, 'provider_outcome_unknown');
      const late = (await one("SELECT public.record_crun_dispatch($1,$2,'ACCEPTED','late-task-1') r", [job, token])).r;
      assert.equal(late.ok, true);
      assert.equal((await one('SELECT public.recover_crun_dispatch() r')).r.ok, true);
      const j = await one('SELECT state,provider,provider_job_id,error_code FROM public.jobs WHERE id=$1', [job]);
      assert.equal(j.state, 'SUBMITTED');
      assert.equal(j.provider_job_id, 'late-task-1');
      assert.equal(j.error_code, null);
      const d = await one('SELECT state,projected_at FROM public.crun_dispatch WHERE job_id=$1', [job]);
      assert.equal(d.state, 'ACCEPTED');
      assert.ok(d.projected_at);
      assert.equal(await refunds(job), 0);
    });
  });

  it('rejects a quote whose catalog endpoint does not match the model or contract', async () => {
    await isolated(async () => {
      const { auth, user } = await mkUser();
      await client.query("UPDATE public.model_catalog SET provider_endpoint='fal-ai/ace-step-1.5' WHERE id='ace-step'");
      const simple = (await one("SELECT public.music_create_quote($1,'mismatch',NULL,'ace-step') r", [auth])).r;
      assert.equal(simple.code, 'MODEL_UNAVAILABLE');
      assert.equal(Number((await one('SELECT count(*) n FROM public.music_prompt_specs WHERE user_id=$1', [user])).n), 0);
      await client.query("UPDATE public.model_catalog SET provider_endpoint='fal-ai/ace-step' WHERE id='ace-step-1.5'");
      const draft = (await one(`INSERT INTO public.music_lyric_drafts(user_id,provider_contract,model_id,lyrics,styles)
        VALUES($1,'fal-ace-v1','ace-step-1.5','la','pop') RETURNING id`, [user])).id;
      const custom = (await one("SELECT public.music_create_custom_quote($1,'fal-ace-v1',$2,0,false,true,60) r", [auth, draft])).r;
      assert.equal(custom.code, 'CONTRACT_STALE');
      assert.equal(Number((await one('SELECT count(*) n FROM public.music_prompt_specs WHERE user_id=$1', [user])).n), 0);
    });
  });

  it('admits a dispatch payload of 5000 + 1000 control characters', async () => {
    await isolated(async () => {
      const { user } = await mkUser();
      const job = await debitFor(user);
      const codes = [1, 2, 3, 4, 5, 6, 7, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
      const ctl = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(codes[i % codes.length])).join('');
      const body = { model: 'suno/music-generate', input: { mode: 'custom', instrumental: false, suno_model: 'v6', lyrics: ctl(5000), tags: ctl(1000) } };
      assert.ok(Buffer.byteLength(JSON.stringify(body)) > 32768, 'fixture must exceed the escaped 32 KiB mark');
      const admitted = (await one("SELECT public.admit_crun_dispatch($1,'crun:suno/music-generate',$2) r", [job, body])).r;
      assert.equal(admitted.ok, true, JSON.stringify(admitted));
      const stored = await one('SELECT octet_length(payload::text) n FROM public.crun_dispatch WHERE job_id=$1', [job]);
      assert.ok(Number(stored.n) > 32768 && Number(stored.n) <= 65536);
      const huge = { ...body, input: { ...body.input, lyrics: ctl(12000) } };
      const job2 = await debitFor(user);
      assert.equal((await one("SELECT public.admit_crun_dispatch($1,'crun:suno/music-generate',$2) r", [job2, huge])).r.code, 'INVALID_INPUTS');
    });
  });

  it('prices flat for the Crun contract and by 60-second blocks for fal, in both directions', async () => {
    for (const [secs, fal] of [[1, 1], [60, 1], [61, 2], [135, 3]]) {
      assert.equal((await one("SELECT private.music_duration_price_blocks('ace-step-1.5','crun-suno-v1',$1) n", [secs])).n, 1, `crun ${secs}`);
      assert.equal((await one("SELECT private.music_duration_price_blocks('ace-step-1.5','fal-ace-v1',$1) n", [secs])).n, fal, `fal ${secs}`);
    }
    assert.equal((await one("SELECT private.music_duration_price_blocks('ace-step','fal-ace-v1',135) n")).n, 1);
    await isolated(async () => {
      assert.equal((await one("SELECT private.music_duration_price_blocks('ace-step-1.5',135) n")).n, 3);
      await client.query("UPDATE public.model_catalog SET provider='crun',provider_endpoint='crun:suno/music-generate' WHERE id='ace-step-1.5'");
      assert.equal((await one("SELECT private.music_duration_price_blocks('ace-step-1.5',135) n")).n, 1);
    });
  });

  it('refunds a circuit-held READY dispatch older than 20 minutes once, and keeps a young UNKNOWN unreconcilable as REJECTED', async () => {
    await isolated(async () => {
      await client.query("UPDATE public.provider_spend_provider_policy SET admission_open=false WHERE provider='crun'");
      const { user } = await mkUser();
      const job = await debitFor(user);
      await client.query(`INSERT INTO public.crun_dispatch(job_id,endpoint,payload,created_at)
        VALUES($1,'crun:suno/music-generate',$2,clock_timestamp()-interval '21 minutes')`, [job, payload]);
      const held = (await one('SELECT public.claim_crun_dispatch($1) r', [job])).r;
      assert.equal(held.held, true);
      assert.equal((await one('SELECT state FROM public.crun_dispatch WHERE job_id=$1', [job])).state, 'READY');
      assert.equal((await one('SELECT public.recover_crun_dispatch() r')).r.ok, true);
      const d = await one('SELECT state,failure_code FROM public.crun_dispatch WHERE job_id=$1', [job]);
      assert.equal(d.state, 'CLOSED');
      assert.equal(d.failure_code, 'supplier_unavailable');
      assert.equal((await one('SELECT state FROM public.jobs WHERE id=$1', [job])).state, 'REFUNDED');
      assert.equal(await refunds(job), 1);
      await one('SELECT public.recover_crun_dispatch() r');
      assert.equal(await refunds(job), 1);

      const youngJob = await debitFor(user);
      const token = randomUUID();
      await client.query(`INSERT INTO public.crun_dispatch(job_id,endpoint,payload,state,attempt_token,started_at,resolved_at,failure_code)
        VALUES($1,'crun:suno/music-generate',$2,'UNKNOWN',$3,clock_timestamp()-interval '3 minutes',clock_timestamp()-interval '5 minutes','provider_outcome_unknown')`,
        [youngJob, payload, token]);
      const young = (await one("SELECT public.reconcile_crun_dispatch_unknown($1,$2,'REJECTED',NULL) r", [youngJob, token])).r;
      assert.equal(young.code, 'UNKNOWN_TOO_YOUNG');
      assert.equal((await one('SELECT state FROM public.crun_dispatch WHERE job_id=$1', [youngJob])).state, 'UNKNOWN');
      assert.equal(await refunds(youngJob), 0);
    });
  });

  it('backfills only legacy fal song-create rows and leaves cover/extend and other rows NULL', async () => {
    const file = await readFile(new URL('./schema/supabase/0591_crun_suno_music_foundation.sql', import.meta.url), 'utf8');
    const updates = [...file.matchAll(/^UPDATE public\.(?:music_prompt_specs SET|music_generation_quotes q SET|music_lyric_drafts SET) provider_contract='fal-ace-v1'[\s\S]*?;$/gm)].map((m) => m[0]);
    const checks = [...file.matchAll(/^DO \$\$ BEGIN[^$]*?backfill left target rows unclassified[\s\S]*?END \$\$;$/gm)].map((m) => m[0]);
    assert.equal(updates.length, 3, 'expected the three backfill UPDATE statements');
    assert.equal(checks.length, 2, 'expected the two backfill DO checks');
    await isolated(async () => {
      // Recreate the pre-0591 shape: contract columns nullable, no binding triggers, no contract CHECK.
      await client.query(`ALTER TABLE public.music_prompt_specs DISABLE TRIGGER music_bind_prompt_contract;
        ALTER TABLE public.music_generation_quotes DISABLE TRIGGER music_bind_quote_contract;
        ALTER TABLE public.music_prompt_specs DROP CONSTRAINT music_prompt_specs_provider_contract_check;
        ALTER TABLE public.music_lyric_drafts ALTER COLUMN provider_contract DROP NOT NULL`);
      const { auth, user } = await mkUser();
      const src = await makeSong(user, 'fal-ace-v1', 10, 10);
      const simple = (id: string) => `INSERT INTO public.music_prompt_specs(user_id,mode,model_id,prompt,instrumental,schema_version) VALUES($1,'simple','${id}','legacy ${id}',true,'music-simple-v1') RETURNING id`;
      const specs: Record<string, string> = {
        aceStep: (await one(simple('ace-step'), [user])).id,
        loop: (await one(simple('ace-step-loop'), [user])).id,
        otherModel: (await one(simple('mmaudio-v2'), [user])).id,
        custom: (await one(`INSERT INTO public.music_prompt_specs(user_id,mode,model_id,prompt,instrumental,schema_version,styles,draft_revision)
          VALUES($1,'custom','ace-step-1.5','legacy custom',true,'music-custom-v1','pop',0) RETURNING id`, [user])).id,
        extend: (await one(`INSERT INTO public.music_prompt_specs(user_id,mode,model_id,prompt,instrumental,schema_version,source_song_id,source_version_id,
            source_duration_seconds,source_rights_version,extend_seconds_after)
          VALUES($1,'extend','ace-step-extend','legacy extend',true,'music-extend-v1',$2,$3,30,'music-extend-source-rights-v1',30) RETURNING id`, [user, src.song, src.version])).id,
        cover: (await one(`INSERT INTO public.music_prompt_specs(user_id,mode,model_id,prompt,instrumental,schema_version,source_song_id,source_version_id,
            source_duration_seconds,source_influence,source_rights_version)
          VALUES($1,'cover','stable-audio-3-cover','legacy cover',true,'music-cover-v1',$2,$3,30,50,'music-cover-source-rights-v1') RETURNING id`, [user, src.song, src.version])).id,
      };
      await client.query('UPDATE public.music_prompt_specs SET provider_contract=NULL WHERE id=$1', [src.spec]);
      const quoteFor = async (spec: string, endpoint: string, model: string) => (await one(`INSERT INTO public.music_generation_quotes(user_id,prompt_spec_id,
          model_id,provider_endpoint,unit_credits,total_credits,catalog_updated_at,expires_at)
        VALUES($1,$2,$3,$4,1,2,now(),now()+interval '5 minutes') RETURNING id`, [user, spec, model, endpoint])).id;
      const quotes: Record<string, string> = {
        aceStep: await quoteFor(specs.aceStep, 'fal-ai/ace-step', 'ace-step'),
        custom: await quoteFor(specs.custom, 'fal-ai/ace-step-1.5', 'ace-step-1.5'),
        extend: await quoteFor(specs.extend, 'fal-ai/ace-step/audio-outpaint', 'ace-step-extend'),
        cover: await quoteFor(specs.cover, 'fal-ai/stable-audio-3/small/music/audio-to-audio', 'stable-audio-3-cover'),
      };
      await client.query('UPDATE public.music_generation_quotes SET provider_contract=NULL WHERE user_id=$1', [user]);
      await client.query('DELETE FROM public.music_lyric_drafts WHERE user_id=$1', [user]);
      const draft = (await one(`INSERT INTO public.music_lyric_drafts(user_id,model_id,provider_contract) VALUES($1,'ace-step-1.5',NULL) RETURNING id`, [user])).id;
      const nullsBefore = (await one('SELECT count(*) n FROM public.music_prompt_specs WHERE user_id=$1 AND provider_contract IS NULL', [user])).n;
      assert.ok(Number(nullsBefore) >= 7, `legacy rows not seeded (${nullsBefore})`);
      for (const sql of updates) await client.query(sql);
      for (const sql of checks) await client.query(sql);
      const spec = async (id: string) => (await one('SELECT provider_contract c FROM public.music_prompt_specs WHERE id=$1', [id])).c;
      const quote = async (id: string) => (await one('SELECT provider_contract c FROM public.music_generation_quotes WHERE id=$1', [id])).c;
      assert.equal(await spec(specs.aceStep), 'fal-ace-v1');
      assert.equal(await spec(specs.loop), 'fal-ace-v1');
      assert.equal(await spec(specs.custom), 'fal-ace-v1');
      assert.equal(await spec(src.spec), 'fal-ace-v1');
      assert.equal(await spec(specs.otherModel), null);
      assert.equal(await spec(specs.extend), null);
      assert.equal(await spec(specs.cover), null);
      assert.equal(await quote(quotes.aceStep), 'fal-ace-v1');
      assert.equal(await quote(quotes.custom), 'fal-ace-v1');
      assert.equal(await quote(quotes.extend), null);
      assert.equal(await quote(quotes.cover), null);
      assert.equal((await one('SELECT provider_contract c FROM public.music_lyric_drafts WHERE id=$1', [draft])).c, 'fal-ace-v1');
      void auth;
    });
  });

  it('browser roles have no Crun table or RPC mutation privileges', async () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one("SELECT has_table_privilege($1,'public.crun_dispatch','SELECT') p", [role])).p, false);
      assert.equal((await one("SELECT has_function_privilege($1,'public.record_crun_dispatch(uuid,uuid,text,text,text,integer)','EXECUTE') p", [role])).p, false);
    }
  });
});
