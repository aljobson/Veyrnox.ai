#!/usr/bin/env node
// ADR-0361. Run only against a disposable local database after migration replay.
// All fixtures and the replay checks are rolled back; never connects to a hosted DB.
import pg from 'pg';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createBeat, upgradeBeatToV5, validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw Error('DATABASE_URL required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) throw Error('Local test database required');
const db = new pg.Client({ connectionString }); await db.connect();
const query = (sql, args = []) => db.query(sql, args);
const value = async (sql, args) => Object.values((await query(sql, args)).rows[0])[0];
const owner = randomUUID();
const actor = async () => { await query('RESET ROLE'); await query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]); await query('SET LOCAL ROLE authenticated'); };
const resetWindow = async () => { await query('RESET ROLE'); await query('DELETE FROM private.music_beat_save_windows WHERE user_id=$1', [owner]); await actor(); };
const refuse = async (sql, args) => {
  await query('SAVEPOINT refused');
  try { await assert.rejects(query(sql, args), error => error.code === 'PT409' && error.message === 'BEAT_CLIENT_OUTDATED'); }
  finally { await query('ROLLBACK TO SAVEPOINT refused'); }
};
const save = schema => `SELECT ${schema}.save_music_beat_project($1,$2,$3,$4,$5,$6)`;
const guardedSave = schema => `SELECT ${schema}.save_music_beat_project($1,$2,$3,$4,$5,$6,$7)`;
const legacyRemove = schema => `SELECT ${schema}.remove_music_beat_project($1,$2)`;
function legacyDocument(version) {
  const doc = createBeat({ id: randomUUID(), now: 1 });
  if (version === 4) return doc;
  const { clips, ...v3 } = doc;
  if (version === 3) return { ...v3, version };
  const { assets, ...v2 } = v3;
  if (version === 2) return { ...v2, version, tracks: v2.tracks.map(({ kind, ...track }) => track) };
  const { tracks, cycle, view, ...v1 } = v2;
  return { ...v1, version, kit: tracks[0].kit };
}
const args = (doc, revision, mode, key) => [doc.id, revision, JSON.stringify(doc, null, 2), doc.title, mode, key];
const snapshot = async id => {
  const project = (await query('SELECT id,doc_json,doc_version,revision,title FROM public.music_beat_projects WHERE id=$1', [id])).rows;
  const versions = (await query('SELECT id,doc_json,revision FROM public.music_beat_project_versions WHERE project_id=$1 ORDER BY id', [id])).rows;
  const takes = (await query('SELECT id,status,byte_size FROM public.music_beat_project_takes WHERE project_id=$1 ORDER BY id', [id])).rows;
  return JSON.stringify({ project, versions, takes });
};
try {
  await query('BEGIN');
  await query('GRANT USAGE ON SCHEMA auth TO authenticated');
  await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [owner, `beat-v5-${owner}@example.invalid`]);
  // Replay twice, and inspect every public/private executable signature.
  const migration = (await readFile(new URL('../packages/db/schema/supabase/0564_music_beat_doc_version_5.sql', import.meta.url), 'utf8')).replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');
  await query(migration); await query(migration);
  const functions = (await query(`SELECT n.nspname AS schema,p.proname AS name,p.pronargs AS argc,p.pronargdefaults AS defaults,
    p.prosecdef AS definer,p.proconfig AS config,p.prosrc AS source,p.oid::regprocedure::text AS signature
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','private') AND p.proname IN ('save_music_beat_project','remove_music_beat_project')`)).rows;
  assert.equal(functions.length, 8, 'no additional unguarded overload');
  for (const fn of functions) {
    assert.equal(fn.defaults, 0); assert.ok(fn.config.some(setting => setting.startsWith('search_path=')));
    const guarded = fn.argc === (fn.name.startsWith('save') ? 7 : 3);
    if (!guarded) { assert.match(fn.source, /private\.(save|remove)_music_beat_project\([^;]+,4\)/); assert.doesNotMatch(fn.source, /\b(INSERT|UPDATE|DELETE)\b/i); }
    else if (fn.schema === 'private') { assert.equal(fn.definer, true); assert.match(fn.source, /BEAT_CLIENT_OUTDATED/); }
    for (const role of ['anon', 'service_role']) assert.equal(await value('SELECT has_function_privilege($1,$2,\'EXECUTE\')', [role, fn.signature]), false);
    assert.equal(await value('SELECT has_function_privilege(\'authenticated\',$1,\'EXECUTE\')', [fn.signature]), true);
  }
  await actor();
  for (const schema of ['public', 'private']) for (const version of [1, 2, 3, 4, 5]) {
    await resetWindow();
    const doc = version === 5 ? upgradeBeatToV5(createBeat({ id: randomUUID(), now: 1 })) : legacyDocument(version);
    if (version === 5) doc.markers = [{ id: 'intro', name: 'Intro', tick: 123 }];
    assert.equal(validateBeat(doc).ok, true);
    const call = version === 5 ? guardedSave(schema) : save(schema);
    const parameters = (d, revision, mode, key) => [...args(d, revision, mode, key), ...(version === 5 ? [5] : [])];
    let project = await value(call, parameters(doc, 0, 'autosave', 'v5-create'));
    const edited = { ...doc, title: 'Edited beat', updatedAt: 2 };
    project = await value(call, parameters(edited, project.revision, 'checkpoint', 'v5-checkpoint'));
    await value(call, parameters(doc, project.revision, 'stash', 'v5-stash'));
    const stored = await value('SELECT doc_json FROM public.music_beat_project_versions WHERE project_id=$1 AND revision=1 ORDER BY saved_at LIMIT 1', [project.id]);
    assert.equal(stored, JSON.stringify(doc, null, 2));
    project = await value(call, parameters(JSON.parse(stored), project.revision, 'checkpoint', 'v5-restore'));
    assert.equal(await value('SELECT doc_json FROM public.music_beat_projects WHERE id=$1', [project.id]), stored);
    if (version !== 5) continue;
    const take = await value('SELECT public.reserve_music_beat_take($1,$2,$3,$4)', [doc.id, 'take-v5', 44, 1]);
    await value('SELECT public.confirm_music_beat_take($1,$2,$3)', [doc.id, take.take_id, 44]);
    const before = await snapshot(project.id);
    const { markers, ...base } = doc; const downgrade = { ...base, version: 4 };
    for (const target of ['public', 'private']) {
      for (const mode of ['autosave', 'checkpoint', 'stash']) {
        await refuse(save(target), args(downgrade, project.revision, mode, `old-${mode}`));
        assert.equal(await snapshot(project.id), before);
      }
      await refuse(legacyRemove(target), [doc.id, project.revision]);
      assert.equal(await snapshot(project.id), before);
      await refuse(guardedSave(target), [...args(downgrade, project.revision, 'autosave', 'no-downgrade'), 5]);
      assert.equal(await snapshot(project.id), before);
    }
    // A current client may remove, including cascades; assertions above prove refusals didn't.
    await value(`SELECT ${schema}.remove_music_beat_project($1,$2,$3)`, [doc.id, project.revision, 5]);
    assert.equal(Number(await value('SELECT count(id) FROM public.music_beat_project_takes WHERE project_id=$1', [project.id])), 0);
  }
  console.log('Beat v5: replay, all eight ACL/signatures, v1–5 save/checkpoint/stash/restore and legacy fences passed');
} finally { await query('ROLLBACK'); await db.end(); }
