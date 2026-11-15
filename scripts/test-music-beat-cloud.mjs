#!/usr/bin/env node
// ADR-0344: fixtures are transaction-local, only in a disposable local database.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw Error('DATABASE_URL required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) throw Error('Local test database required');
const db = new pg.Client({ connectionString }); await db.connect();
const query = (sql, args = []) => db.query(sql, args);
const value = async (sql, args = []) => Object.values((await query(sql, args)).rows[0])[0];
const actor = async id => { await query('RESET ROLE'); await query("SELECT set_config('request.jwt.claim.sub',$1,true)", [id || '']); await query('SET LOCAL ROLE authenticated'); };
const rejects = async (sql, args, code, message) => {
  await query('SAVEPOINT refused');
  try { await assert.rejects(query(sql, args), error => error.code === code && (!message || error.message === message)); }
  finally { await query('ROLLBACK TO SAVEPOINT refused'); }
};
let checks = 0;
const check = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const owner = randomUUID(), other = randomUUID(), beatId = randomUUID();
const doc = createBeat({ id: beatId }), raw = JSON.stringify(doc, null, 1);
const save = 'SELECT public.save_music_beat_project($1,$2,$3,$4,$5,$6)';
const remove = 'SELECT public.remove_music_beat_project($1,$2)';
const reserve = 'SELECT public.reserve_music_beat_take($1,$2,$3,$4)';
const confirm = 'SELECT public.confirm_music_beat_take($1,$2,$3)';
const read = 'SELECT public.read_music_beat_take($1,$2)';
const saveArgs = (revision = 0, content = raw, mode = 'autosave', key = 'create-key-1') => [beatId, revision, content, JSON.parse(content).title, mode, key];
const resetWindow = async () => { await query('RESET ROLE'); await query('DELETE FROM private.music_beat_save_windows WHERE user_id=$1', [owner]); await actor(owner); };
let project, take;
try {
  await query('BEGIN');
  await query('GRANT USAGE ON SCHEMA auth TO authenticated');
  for (const id of [owner, other]) await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `beat-${id}@example.invalid`]);
  const ledger = await value('SELECT count(*) FROM public.ledger_entries'), balances = (await query('SELECT * FROM public.credit_balances ORDER BY user_id')).rows;
  await actor(null);
  await check('all five RPCs require identity', async () => {
    for (const [sql, args] of [[save, saveArgs()], [remove, [beatId, 1]], [reserve, [beatId, 'take', 44, 1]], [confirm, [beatId, randomUUID(), 44]], [read, [beatId, randomUUID()]]]) await rejects(sql, args, 'PT401');
  });
  await actor(owner);
  await check('create exact-text round trip, replay, changed-content key reuse and duplicate create', async () => {
    project = await value(save, saveArgs()); assert.equal(project.revision, 1);
    assert.equal(await value('SELECT doc_json FROM public.music_beat_projects WHERE id=$1', [project.id]), raw);
    assert.deepEqual(await value(save, saveArgs()), { ...project, idempotent: true });
    await rejects(save, saveArgs(0, raw + ' '), 'PT409', 'IDEMPOTENCY_CONFLICT');
    await rejects(save, saveArgs(0, raw, 'autosave', 'another-create'), 'PT409', 'VERSION_CONFLICT');
    assert.equal(Number(await value('SELECT count(id) FROM public.music_beat_project_versions')), 1);
  });
  await check('invalid document, keys, track count, mode and size are refused', async () => {
    for (const content of ['{', 'null', '[]', '{}', JSON.stringify({ ...doc, id: other }), JSON.stringify({ ...doc, version: 5 }), JSON.stringify({ ...doc, tracks: Array(17).fill({}) }), raw + ' '.repeat(262144)])
      await rejects(save, [beatId, 1, content, doc.title, 'autosave', 'invalid-doc'], 'PT400');
    await rejects(save, [beatId, 1, raw, 'Other title', 'autosave', 'invalid-doc'], 'PT400');
    await rejects(save, [beatId, 1, raw, doc.title, 'unknown', 'invalid-mode'], 'PT400');
    await rejects(save, [beatId, 1, raw, doc.title, 'autosave', 'short'], 'PT400');
  });
  await check('updates replay once, reject stale writes and superseded create replays', async () => {
    project = await value(save, saveArgs(1, raw + ' ', 'autosave', 'update-key-1')); assert.equal(project.revision, 2);
    assert.deepEqual(await value(save, saveArgs(1, raw + ' ', 'autosave', 'update-key-1')), { ...project, idempotent: true });
    await rejects(save, saveArgs(1, raw, 'autosave', 'update-key-1'), 'PT409', 'IDEMPOTENCY_CONFLICT');
    await rejects(save, saveArgs(1, raw, 'autosave', 'update-key-2'), 'PT409', 'VERSION_CONFLICT');
    await rejects(save, saveArgs(), 'PT409', 'VERSION_CONFLICT');
    assert.equal(Number(await value('SELECT count(id) FROM public.music_beat_project_versions')), 1, 'autosave spacing');
  });
  await check('five-minute spacing and checkpoint preserve the previous revision', async () => {
    await query('RESET ROLE'); await query("UPDATE public.music_beat_project_versions SET saved_at=now()-interval '6 minutes' WHERE project_id=$1", [project.id]); await actor(owner);
    project = await value(save, saveArgs(2, raw, 'autosave', 'update-key-3'));
    assert.equal(Number(await value('SELECT count(id) FROM public.music_beat_project_versions')), 2);
    project = await value(save, saveArgs(3, raw + '  ', 'autosave', 'update-key-4'));
    project = await value(save, saveArgs(4, raw, 'checkpoint', 'checkpoint-5'));
    assert.equal(await value('SELECT reason FROM public.music_beat_project_versions WHERE project_id=$1 AND revision=4', [project.id]), 'conflict');
    assert.equal(await value('SELECT doc_json FROM public.music_beat_project_versions WHERE project_id=$1 AND revision=4', [project.id]), raw + '  ');
    assert.equal(await value('SELECT reason FROM public.music_beat_project_versions WHERE project_id=$1 AND revision=5', [project.id]), 'checkpoint');
  });
  await check('stash does not change the project; retained retries consume no quota, pruned retries preserve again', async () => {
    const before = (await query('SELECT id,doc_json,title,revision,updated_at FROM public.music_beat_projects WHERE id=$1', [project.id])).rows[0];
    const args = saveArgs(5, raw + '\n', 'stash', 'stash-key-1');
    assert.equal((await value(save, args)).stashed, true);
    const count = Number(await value('SELECT count(id) FROM public.music_beat_project_versions'));
    await query('RESET ROLE'); const writes = await value('SELECT minute_count FROM private.music_beat_save_windows WHERE user_id=$1', [owner]); await actor(owner);
    assert.equal((await value(save, args)).idempotent, true);
    assert.equal(Number(await value('SELECT count(id) FROM public.music_beat_project_versions')), count);
    await query('RESET ROLE'); assert.equal(await value('SELECT minute_count FROM private.music_beat_save_windows WHERE user_id=$1', [owner]), writes); await actor(owner);
    await rejects(save, saveArgs(5, raw, 'stash', 'stash-key-1'), 'PT409', 'IDEMPOTENCY_CONFLICT');
    await rejects(save, saveArgs(4, raw, 'stash', 'stale-stash'), 'PT409', 'VERSION_CONFLICT');
    assert.deepEqual((await query('SELECT id,doc_json,title,revision,updated_at FROM public.music_beat_projects WHERE id=$1', [project.id])).rows[0], before);
    await query('RESET ROLE'); await query("DELETE FROM public.music_beat_project_versions WHERE project_id=$1 AND request_key='stash-key-1'", [project.id]); await actor(owner);
    assert.equal((await value(save, args)).idempotent, false);
  });
  await check('versions are pruned to newest twenty', async () => {
    for (let i = 0; i < 23; i++) { await resetWindow(); project = await value(save, saveArgs(project.revision, raw, 'checkpoint', `checkpoint-${i + 100}`)); }
    assert.equal(Number(await value('SELECT count(id) FROM public.music_beat_project_versions WHERE project_id=$1', [project.id])), 20);
  });
  await resetWindow();
  await check('reserve, immutable ready, size mismatch and beat-bound read/confirm', async () => {
    take = await value(reserve, [beatId, 'take-1', 44, 1]); assert.equal(take.status, 'pending'); assert.match(take.r2_key, new RegExp(`^music-beat-takes/${owner}/[a-f0-9-]+\\.wav$`));
    const renewed = await value(reserve, [beatId, 'take-1', 44, 1]); assert.equal(renewed.take_id, take.take_id);
    assert.equal((await value(read, [beatId, take.take_id])).status, 'pending');
    await rejects(confirm, [beatId, take.take_id, 45], 'PT409', 'SIZE_MISMATCH');
    await rejects(read, [other, take.take_id], 'PT404'); await rejects(confirm, [other, take.take_id, 44], 'PT404');
    await rejects(reserve, [beatId, 'take-1', 45, 1], 'PT409', 'TAKE_CHANGED');
    assert.equal((await value(confirm, [beatId, take.take_id, 44])).status, 'ready');
    assert.equal((await value(confirm, [beatId, take.take_id, 44])).idempotent, true);
    assert.deepEqual(await value(reserve, [beatId, 'take-1', 44, 1]), { take_id: take.take_id, status: 'ready', idempotent: true });
    await rejects(reserve, [beatId, 'take-1', 50, 1], 'PT409', 'TAKE_CHANGED');
  });
  await check('other owner sees no rows and cannot mutate/read foreign content', async () => {
    await actor(other);
    for (const table of ['music_beat_projects', 'music_beat_project_versions', 'music_beat_project_takes']) assert.equal(Number(await value(`SELECT count(id) FROM public.${table}`)), 0);
    await rejects(save, saveArgs(project.revision), 'PT404');
    assert.deepEqual(await value(remove, [beatId, project.revision]), { removed: true, idempotent: true });
    await rejects(reserve, [beatId, 'foreign', 44, 1], 'PT404');
    await rejects(read, [beatId, take.take_id], 'PT404'); await rejects(confirm, [beatId, take.take_id, 44], 'PT404');
    await actor(owner);
  });
  await check('column grants and direct writes are refused on every table', async () => {
    for (const table of ['music_beat_projects', 'music_beat_project_versions', 'music_beat_project_takes']) {
      for (const sql of [`SELECT user_id FROM public.${table}`, `INSERT INTO public.${table}(id) VALUES($1)`, `UPDATE public.${table} SET id=$1`, `DELETE FROM public.${table}`, `TRUNCATE public.${table}`])
        await rejects(sql, sql.includes('$1') ? [randomUUID()] : [], '42501');
    }
    for (const column of ['create_key', 'last_key']) await rejects(`SELECT ${column} FROM public.music_beat_projects`, [], '42501');
    await rejects('SELECT request_key FROM public.music_beat_project_versions', [], '42501');
    await rejects('SELECT r2_key FROM public.music_beat_project_takes', [], '42501');
    await rejects('SELECT * FROM private.music_beat_save_windows', [], '42501');
    for (const role of ['anon', 'service_role']) {
      await query('RESET ROLE'); await query(`SET LOCAL ROLE ${role}`);
      await rejects('SELECT id FROM public.music_beat_projects', [], '42501');
      await rejects(save, saveArgs(), '42501');
    }
    await actor(owner);
  });
  await check('minute/day limits and replay exemption', async () => {
    await query('RESET ROLE'); await query('UPDATE private.music_beat_save_windows SET minute_count=20,day_count=20,minute_start=now(),day_start=now() WHERE user_id=$1', [owner]); await actor(owner);
    await rejects(save, saveArgs(project.revision, raw, 'autosave', 'rate-minute'), 'PT429', 'RATE_LIMITED');
    assert.equal((await value(save, saveArgs(project.revision - 1, raw, 'checkpoint', 'checkpoint-122'))).idempotent, true);
    await query('RESET ROLE'); await query('UPDATE private.music_beat_save_windows SET minute_count=0,day_count=2000 WHERE user_id=$1', [owner]); await actor(owner);
    await rejects(reserve, [beatId, 'rate-day', 44, 1], 'PT429', 'RATE_LIMITED'); await resetWindow();
  });
  await check('50 projects/account cap', async () => {
    await query('SAVEPOINT caps');
    for (let i = 1; i < 50; i++) {
      await resetWindow(); const id = randomUUID(), d = createBeat({ id });
      await value(save, [id, 0, JSON.stringify(d), d.title, 'autosave', `cap-project-${i}`]);
    }
    const id = randomUUID(), d = createBeat({ id });
    await rejects(save, [id, 0, JSON.stringify(d), d.title, 'autosave', 'cap-project-last'], 'PT429', 'LIMIT_REACHED');
    await query('ROLLBACK TO SAVEPOINT caps');
  });
  await check('64 takes/project and 1 GB/account caps', async () => {
    await query('SAVEPOINT takes_cap');
    for (let i = 1; i < 64; i++) { await resetWindow(); await value(reserve, [beatId, `cap-${i}`, 44, 1]); }
    await rejects(reserve, [beatId, 'over-64', 44, 1], 'PT429', 'LIMIT_REACHED');
    await query('ROLLBACK TO SAVEPOINT takes_cap');
    await query('SAVEPOINT bytes_cap');
    for (let i = 0; i < 16; i++) { await resetWindow(); await value(reserve, [beatId, `large-${i}`, 60000000, 600]); }
    await rejects(reserve, [beatId, 'over-gb', 60000000, 600], 'PT429', 'LIMIT_REACHED');
    await query('ROLLBACK TO SAVEPOINT bytes_cap');
  });
  const deadline = async t => {
    await query('RESET ROLE');
    assert.equal(await value('SELECT not_before >= $2::timestamptz + interval \'5 minutes\' FROM public.asset_reap_queue WHERE r2_key=$1', [t.r2_key, t.upload_expires_at]), true);
    await actor(owner);
  };
  await check('direct delete, project removal and Auth cascade reap after issued upload deadlines', async () => {
    await resetWindow(); const direct = await value(reserve, [beatId, 'direct', 44, 1]);
    await query('RESET ROLE'); await query('DELETE FROM public.music_beat_project_takes WHERE id=$1', [direct.take_id]); await deadline(direct);
    await rejects(remove, [beatId, project.revision - 1], 'PT409', 'VERSION_CONFLICT');
    await value(remove, [beatId, project.revision]); await deadline(take);
    assert.equal(Number(await value('SELECT count(id) FROM public.music_beat_project_versions')), 0);
    assert.deepEqual(await value(remove, [beatId, project.revision]), { removed: true, idempotent: true });
    await resetWindow(); await value(save, saveArgs());
    const cascade = await value(reserve, [beatId, 'cascade', 44, 1]);
    await query('RESET ROLE'); await query('DELETE FROM auth.users WHERE id=$1', [owner]); await deadline(cascade);
    await query('RESET ROLE');
    for (const table of ['public.music_beat_projects', 'public.music_beat_project_versions', 'public.music_beat_project_takes', 'private.music_beat_save_windows']) assert.equal(Number(await value(`SELECT count(*) FROM ${table} WHERE user_id=$1`, [owner])), 0);
  });
  await check('migration reapplication twice is idempotent inside rollback', async () => {
    const sql = (await readFile(new URL('../packages/db/schema/supabase/0542_music_beat_cloud.sql', import.meta.url), 'utf8')).replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
    await query(sql); await query(sql);
  });
  await check('no ledger or credit-balance writes', async () => {
    assert.equal(await value('SELECT count(*) FROM public.ledger_entries'), ledger);
    assert.deepEqual((await query('SELECT * FROM public.credit_balances ORDER BY user_id')).rows, balances);
  });
} finally { await query('ROLLBACK'); await db.end(); }
console.log(`Music beat cloud acceptance: ${checks} checks passed`);
