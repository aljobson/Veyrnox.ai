#!/usr/bin/env node
// House SQL acceptance runner. All fixtures and migration replays roll back.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw Error('DATABASE_URL required');
const target = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(target.pathname)) throw Error('Local test database required');
const db = new pg.Client({ connectionString }); await db.connect();
const query = (sql, args = []) => db.query(sql, args);
const value = async (sql, args = []) => Object.values((await query(sql, args)).rows[0])[0];
const call = (fn, ...args) => value(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args);
const signup = async () => {
  const auth = randomUUID(); await query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
  return { auth, user: await value('SELECT id FROM public.users WHERE auth_id=$1', [auth]) };
};
const payload = (actor, overrides = {}) => ({ actor, song: randomUUID(), version: randomUUID(), job: randomUUID(), asset: randomUUID(),
  key: randomUUID(), title: 'Night Drive', size: 1920044, sha: 'a'.repeat(64), duration: 10, sources: [], takes: false, rights: false, ...overrides });
const reserve = p => call('music_reserve_mixdown', p.actor.auth, p.song, p.version, p.job, p.asset, p.key, p.title, p.size, p.sha, p.duration, JSON.stringify(p.sources), p.takes, p.rights);
const commit = (p, overrides = {}) => { const x = { ...p, ...overrides }; return call('music_commit_mixdown', x.actor.auth, x.key, x.version, x.size, x.sha, x.duration); };
const abandon = p => call('music_abandon_mixdown', p.actor.auth, p.key, p.version);
const reap = p => value('SELECT count(*)::integer FROM public.asset_reap_queue WHERE r2_key=$1', [`music-renders/${p.actor.user}/${p.version}.wav`]);
const check = async (name, fn) => { await fn(); console.log(`ok ${name}`); };
const rejected = async (sql, args, code = '23514') => {
  await query('SAVEPOINT refusal');
  try { await assert.rejects(query(sql, args), e => e.code === code); }
  finally { await query('ROLLBACK TO SAVEPOINT refusal'); }
};
await query('BEGIN');
try {
  const migration = await readFile(new URL('../packages/db/schema/supabase/0544_music_studio_mixdown.sql', import.meta.url), 'utf8');
  await query(migration); await query(migration);
  const alice = await signup(), bob = await signup();
  const before = await value('SELECT jsonb_build_object(\'entries\',(SELECT count(*) FROM public.ledger_entries),\'balances\',(SELECT jsonb_agg(to_jsonb(b) ORDER BY user_id) FROM public.credit_balances b))');
  const root = payload(alice); assert.equal((await reserve(root)).ok, true); assert.equal((await commit(root)).ok, true);
  const source = { song_id: root.song, version_id: root.version }, mix = payload(alice, { sources: [source] });
  await check('reserve, hash conflicts, rights and ownership refusals', async () => {
    assert.equal((await reserve(mix)).ok, true); assert.equal((await reserve(mix)).idempotent, true);
    for (const patch of [{ sha: 'b'.repeat(64) }, { size: 1920048 }, { duration: 9 }, { title: 'Other' }, { sources: [] }, { takes: true, rights: true }]) {
      assert.equal((await reserve({ ...mix, ...patch })).code, 'IDEMPOTENCY_CONFLICT');
    }
    assert.equal((await reserve(payload(alice, { takes: true }))).code, 'RIGHTS_REQUIRED');
    assert.equal((await reserve(payload(alice, { rights: true }))).code, 'RIGHTS_REQUIRED');
    assert.equal((await reserve(payload(bob, { sources: [source] }))).code, 'SOURCE_UNAVAILABLE');
    assert.equal((await commit(mix, { sha: 'b'.repeat(64) })).code, 'IDEMPOTENCY_CONFLICT');
  });
  await check('commit creates one private mixdown, local zero-credit job and lineage', async () => {
    assert.equal((await commit(mix)).ok, true); assert.equal((await commit(mix)).idempotent, true);
    assert.equal(await value('SELECT count(*)::integer FROM public.music_songs WHERE id=$1', [mix.song]), 1);
    const row = (await query('SELECT v.generation_request_id,v.operation,v.version_number,s.visibility,j.credits,j.provider,j.state FROM public.music_song_versions v JOIN public.music_songs s ON s.id=v.song_id JOIN public.jobs j ON j.id=v.job_id WHERE v.id=$1', [mix.version])).rows[0];
    assert.deepEqual(row, { generation_request_id: null, operation: 'studio_mixdown', version_number: 1, visibility: 'private', credits: 0, provider: 'local', state: 'STORED' });
    assert.equal(await value('SELECT relation FROM public.music_version_sources WHERE output_version_id=$1', [mix.version]), 'mix_source');
    assert.equal((await commit(mix, { duration: 10.01 })).code, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await abandon(mix)).code, 'RESERVATION_CLOSED'); assert.equal(await reap(mix), 0);
    const after = await value('SELECT jsonb_build_object(\'entries\',(SELECT count(*) FROM public.ledger_entries),\'balances\',(SELECT jsonb_agg(to_jsonb(b) ORDER BY user_id) FROM public.credit_balances b))');
    assert.deepEqual(after, before, 'no ledger or balances changed');
  });
  await check('committed replay survives source trash, while new reserved commits recheck sources', async () => {
    const pending = payload(alice, { sources: [source] }); assert.equal((await reserve(pending)).ok, true);
    const revision = await value('SELECT revision FROM public.music_songs WHERE id=$1', [root.song]);
    assert.equal((await call('music_set_song_lifecycle', alice.auth, root.song, revision, 'trash')).ok, true);
    assert.equal((await reserve(mix)).status, 'committed'); assert.equal((await commit(mix)).idempotent, true);
    assert.equal((await commit(pending)).code, 'SOURCE_UNAVAILABLE'); assert.equal(await reap(mix), 0);
    assert.equal((await abandon(pending)).ok, true); assert.equal(await reap(pending), 1);
  });
  await check('closed tombstones bind keys and delayed abandon cannot affect a new version', async () => {
    const old = payload(bob); await reserve(old); assert.equal((await abandon(old)).ok, true);
    assert.equal((await reserve(old)).code, 'RESERVATION_CLOSED');
    const fresh = payload(bob); await reserve(fresh);
    assert.equal((await abandon({ ...fresh, version: old.version })).code, 'NOT_FOUND');
    assert.equal((await commit(fresh)).ok, true); assert.equal(await reap(fresh), 0);
  });
  await check('renewal at minute 44, refusal at minute 46, expiry and reaper grace', async () => {
    const pending = payload(bob); await reserve(pending);
    await query("UPDATE public.music_mixdown_reservations SET created_at=now()-interval '44 minutes',expires_at=now()+interval '16 minutes',upload_expires_at=now()-interval '29 minutes' WHERE version_id=$1", [pending.version]);
    assert.equal((await reserve(pending)).ok, true);
    const lease = await value('SELECT upload_expires_at FROM public.music_mixdown_reservations WHERE version_id=$1', [pending.version]);
    await query("UPDATE public.music_mixdown_reservations SET expires_at=now()+interval '14 minutes' WHERE version_id=$1", [pending.version]);
    assert.equal((await reserve(pending)).code, 'RESERVATION_EXPIRED');
    await query("UPDATE public.music_mixdown_reservations SET expires_at=now()-interval '1 second' WHERE version_id=$1", [pending.version]);
    await call('music_expire_mixdown_reservations'); assert.equal((await commit(pending)).code, 'RESERVATION_CLOSED');
    const deadline = await value('SELECT not_before FROM public.asset_reap_queue WHERE r2_key=$1', [`music-renders/${bob.user}/${pending.version}.wav`]);
    assert.ok(deadline.getTime() >= lease.getTime() + 300000);
    await query("UPDATE public.music_mixdown_reservations SET closed_at=now()-interval '31 days' WHERE version_id=$1", [pending.version]);
    await call('music_expire_mixdown_reservations');
    assert.equal(await value('SELECT count(*)::integer FROM public.music_mixdown_reservations WHERE version_id=$1', [pending.version]), 0);
  });
  await check('reserve then freeze refuses commit, without direct frozen_at writes', async () => {
    const frozen = await signup(), pending = payload(frozen); await reserve(pending);
    await call('freeze_account', frozen.user, 'Mixdown SQL fixture', null);
    assert.equal((await commit(pending)).code, 'ACCOUNT_FROZEN');
    assert.equal((await reserve(payload(frozen))).code, 'ACCOUNT_FROZEN');
  });
  await check('erasure through prepare and erase queues renewed uncommitted uploads', async () => {
    const actor = await signup(), pending = payload(actor); await reserve(pending);
    await query("UPDATE public.music_mixdown_reservations SET expires_at=now()+interval '16 minutes',upload_expires_at=now() WHERE version_id=$1", [pending.version]);
    await reserve(pending);
    const lease = await value('SELECT upload_expires_at FROM public.music_mixdown_reservations WHERE version_id=$1', [pending.version]);
    const prepared = await call('prepare_account_deletion', actor.auth); assert.equal(prepared.eligible, true, JSON.stringify(prepared));
    const erased = await call('erase_account', actor.auth, prepared.confirmation_token); assert.equal(erased.ok, true, JSON.stringify(erased));
    assert.equal(await value('SELECT count(*)::integer FROM public.music_mixdown_reservations WHERE user_id=$1', [actor.user]), 0);
    const deadline = await value('SELECT not_before FROM public.asset_reap_queue WHERE r2_key=$1', [`music-renders/${actor.user}/${pending.version}.wav`]);
    assert.ok(deadline.getTime() >= lease.getTime() + 300000);
  });
  await check('all six local edit writers preserve NULL request and parent; library/detail include edits', async () => {
    let parent = mix.version;
    for (const operation of ['crop', 'fade', 'speed', 'reorder', 'remaster', 'reverse']) {
      const version = randomUUID(), common = [alice.auth, mix.song, parent, version, randomUUID(), randomUUID(), `music-renders/${alice.user}/${version}.wav`, 1920044, 'a'.repeat(64)];
      const params = { fade: { fade_in_seconds: 1, fade_out_seconds: 1 }, speed: { speed_ratio: 0.5 }, reorder: { split_seconds: 5, order: [2, 1] }, remaster: { target_peak_dbfs: -1 }, reverse: {} };
      const result = operation === 'crop'
        ? await call('music_commit_rendered_wav_crop', ...common, 0, 10, 10, 10, randomUUID())
        : await call(operation === 'reorder' ? 'music_commit_reordered_wav' : 'music_commit_local_wav_render', ...common, operation, JSON.stringify(params[operation]), 10, operation === 'speed' ? 20 : 10, randomUUID());
      assert.equal(result.ok, true, JSON.stringify(result));
      const row = (await query('SELECT generation_request_id,parent_version_id FROM public.music_song_versions WHERE id=$1', [version])).rows[0];
      assert.deepEqual(row, { generation_request_id: null, parent_version_id: parent }); parent = version;
    }
    for (const songs of [await call('music_list_songs', alice.auth, 50), await call('music_library_songs', alice.auth, null, null, 50, 'active')]) assert.ok(songs.songs.some(s => s.id === mix.song));
    const detail = await call('music_get_song', alice.auth, mix.song); assert.equal(detail.song.versions.length, 7); assert.ok(detail.song.lineage.some(e => e.relation === 'mix_source'));
    assert.equal((await call('music_get_publication_context', alice.auth, mix.song, parent)).ok, true);
    assert.equal((await call('music_get_reuse_draft_context', alice.auth, mix.song, parent)).code, 'REUSE_UNAVAILABLE');
    await rejected("INSERT INTO public.music_song_versions(user_id,song_id,generation_request_id,job_id,audio_asset_id,version_number,operation) VALUES($1,$2,NULL,$3,$4,99,'crop')", [alice.user, mix.song, mix.job, mix.asset]);
  });
  await check('twenty open reservations per hour and recorded take rights', async () => {
    const actor = await signup();
    for (let n = 0; n < 20; n++) assert.equal((await reserve(payload(actor))).ok, true);
    assert.equal((await reserve(payload(actor))).code, 'RATE_LIMITED');
    const take = payload(alice, { takes: true, rights: true }); await reserve(take); assert.equal((await commit(take)).ok, true);
    assert.equal(await value("SELECT provenance->'studio_mixdown'->>'rights_version' FROM public.music_song_versions WHERE id=$1", [take.version]), 'music-mixdown-rights-v1');
  });
  await check('zero-credit job exceptions remain restricted and browser roles cannot call mixdown RPCs', async () => {
    await rejected("INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,state,provider,inputs) VALUES($1,$2,'music-local-mixdown',0,'STORED','fal','{}')", [alice.user, randomUUID()]);
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await value("SELECT has_function_privilege($1,'public.music_commit_mixdown(text,text,uuid,bigint,text,numeric)','EXECUTE')", [role]), false);
      assert.equal(await value("SELECT has_table_privilege($1,'public.music_mixdown_reservations','SELECT')", [role]), false);
    }
  });
  console.log('Mixdown SQL acceptance passed; all fixtures rolled back.');
} finally { await query('ROLLBACK'); await db.end(); }
