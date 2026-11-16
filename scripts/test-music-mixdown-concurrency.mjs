#!/usr/bin/env node
// Commits its fixture to observe a real lock wait, then deletes it again.
// Never run against a shared or production database.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw Error('DATABASE_URL required');
const target = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(target.pathname)) throw Error('Local test database required');
const a = new pg.Client({ connectionString }), b = new pg.Client({ connectionString });
await a.connect(); await b.connect();
const value = async (client, sql, args = []) => Object.values((await client.query(sql, args)).rows[0])[0];
let pending, fixture;
try {
  const auth = randomUUID(), song = randomUUID(), version = randomUUID(), job = randomUUID(), asset = randomUUID(), key = randomUUID(), sha = 'a'.repeat(64);
  fixture = { song, version, job, asset };
  await a.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
  const before = await value(a, "SELECT jsonb_build_object('entries',(SELECT count(*) FROM public.ledger_entries),'balances',(SELECT jsonb_agg(to_jsonb(b) ORDER BY user_id) FROM public.credit_balances b))");
  const reservation = await value(a, 'SELECT public.music_reserve_mixdown($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
    [auth, song, version, job, asset, key, 'Concurrent mixdown fixture', 1920044, sha, 10, '[]', false, false]);
  assert.equal(reservation.ok, true);
  const commitSql = 'SELECT public.music_commit_mixdown($1,$2,$3,$4,$5,$6)', args = [auth, key, version, 1920044, sha, 10];
  const pid = await value(b, 'SELECT pg_backend_pid()');
  await b.query("SET statement_timeout='12s'");
  await a.query('BEGIN');
  const first = await value(a, commitSql, args);
  assert.equal(first.ok, true); assert.equal(first.idempotent, false);
  let settled = false, second, secondError;
  pending = value(b, commitSql, args).then(result => { second = result; }, error => { secondError = error; }).finally(() => { settled = true; });
  // Observe the database lock itself rather than assuming a sleep proves a race.
  const deadline = Date.now() + 8000;
  let blocked = false;
  while (!settled && !blocked) {
    await a.query('SELECT pg_stat_clear_snapshot()');
    blocked = await value(a, "SELECT wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0 FROM pg_stat_activity WHERE pid=$1", [pid]);
    assert.ok(Date.now() < deadline, 'second commit never reached a lock wait');
  }
  assert.equal(blocked, true, 'second commit must wait on the first transaction');
  await a.query('COMMIT'); await pending;
  if (secondError) throw secondError;
  assert.equal(second.ok, true); assert.equal(second.idempotent, true);
  assert.equal(second.song_id, song); assert.equal(second.version_id, version);
  assert.equal(await value(a, 'SELECT count(*)::integer FROM public.music_songs WHERE id=$1', [song]), 1);
  assert.equal(await value(a, 'SELECT count(*)::integer FROM public.music_song_versions WHERE id=$1', [version]), 1);
  assert.equal(await value(a, 'SELECT count(*)::integer FROM public.jobs WHERE id=$1', [job]), 1);
  assert.equal(await value(a, 'SELECT count(*)::integer FROM public.asset_reap_queue q JOIN public.music_mixdown_reservations r USING(r2_key) WHERE r.version_id=$1', [version]), 0);
  const after = await value(a, "SELECT jsonb_build_object('entries',(SELECT count(*) FROM public.ledger_entries),'balances',(SELECT jsonb_agg(to_jsonb(b) ORDER BY user_id) FROM public.credit_balances b))");
  assert.deepEqual(after, before);
  console.log('PASS concurrent commits wait on the user lock, create one song/version/job, replay identical ids, never queue its asset, and leave the ledger unchanged.');
} finally {
  await a.query('ROLLBACK').catch(() => {});
  if (pending) await pending;
  await b.query('ROLLBACK').catch(() => {});
  // Remove the committed fixture: later scripts in the shared rebuild_check chain
  // replay older jobs checks that refuse a zero-credit local job.
  if (fixture) {
    await a.query('BEGIN');
    for (const [sql, args] of [
      ['DELETE FROM public.music_mixdown_reservations WHERE version_id=$1', [fixture.version]],
      ['DELETE FROM public.music_version_sources WHERE output_version_id=$1', [fixture.version]],
      ['UPDATE public.music_songs SET current_version_id=NULL WHERE id=$1', [fixture.song]],
      ['DELETE FROM public.music_song_versions WHERE id=$1', [fixture.version]],
      ['DELETE FROM public.music_songs WHERE id=$1', [fixture.song]],
      ['DELETE FROM public.assets WHERE id=$1', [fixture.asset]],
      ['DELETE FROM public.jobs WHERE id=$1', [fixture.job]],
    ]) await a.query(sql, args);
    await a.query('COMMIT');
  }
  await Promise.all([a.end(), b.end()]);
}
