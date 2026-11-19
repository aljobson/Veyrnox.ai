#!/usr/bin/env node
// Optional companion to test-music-beat-v5.mjs: real local PostgREST overload selection.
// Needs an already-running local PostgREST against the disposable test DB, configured
// with MUSIC_BEAT_TEST_JWT_SECRET. Creates committed fixtures for HTTP visibility,
// then removes the fixture account in finally. Never runs against a hosted service.
import pg from 'pg';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { createBeat, upgradeBeatToV5 } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
const connectionString = process.env.DATABASE_URL;
const rest = process.env.MUSIC_BEAT_TEST_REST_URL;
const secret = process.env.MUSIC_BEAT_TEST_JWT_SECRET;
if (!connectionString || !rest || !secret) throw Error('Local DATABASE_URL, MUSIC_BEAT_TEST_REST_URL and MUSIC_BEAT_TEST_JWT_SECRET required');
const local = url => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
if (!local(connectionString) || !local(rest) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(new URL(connectionString).pathname)) throw Error('Disposable local services required');
const db = new pg.Client({ connectionString }); await db.connect();
const owner = randomUUID(), doc = upgradeBeatToV5(createBeat({ id: randomUUID(), now: 1 }));
doc.markers = [{ id: 'intro', name: 'Intro', tick: 123 }];
const raw = JSON.stringify(doc, null, 2);
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'authenticated', sub: owner, exp: Math.floor(Date.now() / 1000) + 300 })}`;
const token = `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`;
async function http(path, body) {
  const response = await fetch(`${rest.replace(/\/$/, '')}/${path}`, { redirect: 'error', signal: AbortSignal.timeout(10000),
    method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const snapshot = async () => {
  const result = [];
  for (const table of ['music_beat_projects', 'music_beat_project_versions', 'music_beat_project_takes'])
    result.push((await db.query(`SELECT * FROM public.${table} WHERE user_id=$1 ORDER BY id`, [owner])).rows);
  return JSON.stringify(result);
};
try {
  await db.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [owner, `beat-rest-${owner}@example.invalid`]);
  await db.query('BEGIN');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);
  await db.query('SET LOCAL ROLE authenticated');
  await db.query('SELECT public.save_music_beat_project($1,0,$2,$3,$4,$5,5)', [doc.id, raw, doc.title, 'checkpoint', 'rest-fixture']);
  await db.query('SELECT public.reserve_music_beat_take($1,$2,44,1)', [doc.id, 'rest-take']);
  await db.query('COMMIT');
  const listing = await http(`music_beat_projects?select=id,doc_json,doc_version,revision&beat_id=eq.${doc.id}`);
  assert.equal(listing.status, 200); assert.equal(listing.data[0].doc_json, raw);
  const before = await snapshot();
  const { markers, ...oldDoc } = doc; oldDoc.version = 4;
  for (const p_mode of ['autosave', 'checkpoint', 'stash']) {
    const args = { p_beat_id: doc.id, p_expected_revision: 1, p_doc: JSON.stringify(oldDoc), p_title: doc.title, p_mode, p_idempotency_key: `rest-old-${p_mode}` };
    for (const declared of [undefined, 4]) {
      const result = await http('rpc/save_music_beat_project', { ...args, ...(declared ? { p_client_beat_version: declared } : {}) });
      assert.equal(result.status, 409); assert.equal(result.data.message, 'BEAT_CLIENT_OUTDATED');
      assert.equal(await snapshot(), before);
    }
  }
  for (const declared of [undefined, 4]) {
    const result = await http('rpc/remove_music_beat_project', { p_beat_id: doc.id, p_expected_revision: 1, ...(declared ? { p_client_beat_version: declared } : {}) });
    assert.equal(result.status, 409); assert.equal(result.data.message, 'BEAT_CLIENT_OUTDATED'); assert.equal(await snapshot(), before);
  }
  console.log('Beat v5 PostgREST: legacy/declared replace, checkpoint, stash and delete refused; all rows intact');
} finally {
  await db.query('ROLLBACK');
  await db.query('RESET ROLE');
  // The synthetic take never uploaded an object; remove only this fixture's reap entry.
  await db.query('DELETE FROM auth.users WHERE id=$1', [owner]);
  await db.query('DELETE FROM public.asset_reap_queue WHERE r2_key LIKE $1', [`music-beat-takes/${owner}/%`]);
  await db.end();
}
