#!/usr/bin/env node
// ADR-0245: destructive fixtures only in a migrated, throwaway local database.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyFilm, SHOT_LANES } from '../app/veyrnox/_lib/filmStudio.js';
import { parseFilm } from '../app/veyrnox/_lib/filmStudioStorage.js';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw Error('DATABASE_URL for a migrated local test database is required');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) throw Error('Local test database required');
const db = new pg.Client({ connectionString });
await db.connect();
const query = (sql, args = []) => db.query(sql, args);
const value = async (sql, args = []) => Object.values((await query(sql, args)).rows[0])[0];
const actor = async id => {
  await query('RESET ROLE');
  await query("SELECT set_config('request.jwt.claim.sub',$1,true)", [id || '']);
  await query('SET LOCAL ROLE authenticated');
};
const rejects = async (sql, args, code, message) => {
  await query('SAVEPOINT denied');
  try { await assert.rejects(query(sql, args), e => e.code === code && (!message || e.message === message)); }
  finally { await query('ROLLBACK TO SAVEPOINT denied'); }
};
let checks = 0;
const check = async (name, fn) => { await fn(); console.log(`ok ${++checks} - ${name}`); };
const owner = randomUUID(), other = randomUUID();
const save = 'SELECT public.save_film_studio($1,$2,$3,$4,$5)';
const remove = 'SELECT public.remove_film_studio($1,$2)';
// Deliberately non-alphabetical keys and whitespace must survive SQL unchanged.
const raw = JSON.stringify({ shots: [], name: 'Original', schema: 1, ...emptyFilm() }, null, 1);
let project;
try {
  await query('BEGIN');
  await query('GRANT USAGE ON SCHEMA auth TO authenticated');
  for (const id of [owner, other]) await query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [id, `film-${id}@example.invalid`]);
  await actor(null);
  await check('missing identity is refused by both RPCs', async () => {
    await rejects(save, [null, 0, raw, 'Film', 'create-key-1'], 'PT401');
    await rejects(remove, [randomUUID(), 1], 'PT401');
  });
  await actor(owner);
  await check('create, exact-text read, replay and idempotency conflicts', async () => {
    const first = await value(save, [null, 0, raw, 'Film', 'create-key-1']);
    project = first.id;
    assert.equal(first.revision, 1); assert.equal(first.idempotent, false); assert.equal(first.shot_count, 0);
    assert.deepEqual(Object.keys(first).sort(), ['id', 'name', 'shot_count', 'revision', 'created_at', 'updated_at', 'idempotent'].sort());
    assert.equal(await value('SELECT film_json FROM public.film_studio_projects WHERE id=$1', [project]), raw);
    const replay = await value(save, [null, 0, raw, 'Film', 'create-key-1']);
    assert.deepEqual(replay, { ...first, idempotent: true });
    assert.equal(Number(await value('SELECT count(id) FROM public.film_studio_projects')), 1);
    await rejects(save, [null, 0, raw + ' ', 'Film', 'create-key-1'], 'PT409', 'IDEMPOTENCY_CONFLICT');
    await rejects(save, [null, 0, raw, 'Changed', 'create-key-1'], 'PT409', 'IDEMPOTENCY_CONFLICT');
  });
  await check('update, stale revision, replay and text/name conflicts', async () => {
    const updated = await value(save, [project, 1, raw + ' ', 'Changed', 'update-key-1']);
    assert.equal(updated.revision, 2);
    assert.deepEqual(await value(save, [project, 1, raw + ' ', 'Changed', 'update-key-1']), { ...updated, idempotent: true });
    await rejects(save, [project, 1, raw, 'Changed', 'update-key-2'], 'PT409', 'VERSION_CONFLICT');
    await rejects(save, [project, 1, raw, 'Changed', 'update-key-1'], 'PT409', 'IDEMPOTENCY_CONFLICT');
    await rejects(save, [project, 1, raw + ' ', 'Other', 'update-key-1'], 'PT409', 'IDEMPOTENCY_CONFLICT');
    assert.equal(await value('SELECT film_json FROM public.film_studio_projects WHERE id=$1', [project]), raw + ' ');
  });
  await check('invalid JSON, bounds, names, keys and revisions are refused', async () => {
    for (const content of [null, '{', 'null', '[]', '{}', '{"schema":2,"shots":[]}', '{"schema":1,"shots":null}',
      JSON.stringify({ schema: 1, shots: Array(201).fill({}) }), raw + ' '.repeat(1_000_001 - Buffer.byteLength(raw))])
      await rejects(save, [null, 0, content, 'Film', 'invalid-film'], 'PT400', 'INVALID_REQUEST');
    for (const name of [null, '', '   ', 'x'.repeat(121)]) await rejects(save, [null, 0, raw, name, 'invalid-name'], 'PT400');
    for (const key of [null, 'short', 'invalid key', 'x'.repeat(129)]) await rejects(save, [null, 0, raw, 'Film', key], 'PT400');
    for (const expected of [null, -1, 1]) await rejects(save, [null, expected, raw, 'Film', 'invalid-revision'], 'PT400');
    await rejects(save, [project, 0, raw, 'Film', 'invalid-revision'], 'PT400');
  });
  await check('RLS hides A from B; foreign save and remove cannot alter A', async () => {
    await actor(other);
    assert.equal(Number(await value('SELECT count(id) FROM public.film_studio_projects')), 0);
    await rejects(save, [project, 2, raw, 'Intrusion', 'foreign-save'], 'PT404');
    assert.deepEqual(await value(remove, [project, 2]), { removed: true, idempotent: true });
    await actor(owner);
    assert.equal(await value('SELECT revision FROM public.film_studio_projects WHERE id=$1', [project]), 2);
  });
  await check('anon cannot read; authenticated cannot mutate directly or read private columns/windows', async () => {
    await query('SET LOCAL ROLE anon');
    await rejects('SELECT id FROM public.film_studio_projects', [], '42501');
    await rejects(save, [null, 0, raw, 'Film', 'anon-create'], '42501');
    await rejects(remove, [project, 2], '42501');
    await actor(owner);
    await rejects('INSERT INTO public.film_studio_projects(user_id,name,film_json,shot_count,create_key,last_key) VALUES($1,$2,$3,0,$4,$4)', [owner, 'Direct', raw, 'direct-key'], '42501');
    await rejects('UPDATE public.film_studio_projects SET name=$1 WHERE id=$2', ['Direct', project], '42501');
    await rejects('DELETE FROM public.film_studio_projects WHERE id=$1', [project], '42501');
    await rejects('TRUNCATE public.film_studio_projects', [], '42501');
    for (const column of ['user_id', 'create_key', 'last_key']) await rejects(`SELECT ${column} FROM public.film_studio_projects`, [], '42501');
    await rejects('SELECT * FROM private.film_studio_save_windows', [], '42501');
  });
  await check('near-limit escaped text round-trips unchanged and computes shot count', async () => {
    const film = emptyFilm();
    film.shots = Array.from({ length: 21 }, (_, i) => ({ ...Object.fromEntries(SHOT_LANES.flatMap(([, fields]) => fields.map(([key]) => [key, '']))), id: `s${i}`, oneAction: true }));
    for (const shot of film.shots) {
      const remaining = 999999 - Buffer.byteLength(JSON.stringify(film));
      shot.description = '"\\'.repeat(12000).slice(0, Math.min(24000, Math.floor(remaining / 2)));
    }
    film.script = ' '.repeat(999999 - Buffer.byteLength(JSON.stringify(film)));
    const text = JSON.stringify(film); parseFilm(text);
    assert.equal(Buffer.byteLength(text), 999999);
    assert.ok(Buffer.byteLength(JSON.stringify({ studio_json: text })) > 1_100_000);
    const result = await value(save, [null, 0, text, 'Escaped', 'escaped-film']);
    assert.equal(result.shot_count, 21);
    assert.equal(await value('SELECT film_json FROM public.film_studio_projects WHERE id=$1', [result.id]), text);
  });
  await check('21st film hits item cap; idempotent create still succeeds at cap', async () => {
    await query('SAVEPOINT item_cap');
    for (let i = 2; i < 20; i++) await value(save, [null, 0, raw, 'Film', `cap-film-${i}`]);
    await rejects(save, [null, 0, raw, 'Film', 'cap-film-21'], 'PT429', 'LIMIT_REACHED');
    assert.equal((await value(save, [null, 0, raw, 'Film', 'cap-film-2'])).idempotent, true);
    assert.equal(Number(await value('SELECT count(id) FROM public.film_studio_projects')), 20);
    await query('ROLLBACK TO SAVEPOINT item_cap');
  });
  await check('31st write is throttled, replay is free, and expired windows reset', async () => {
    await query('SAVEPOINT minute_cap');
    await query('RESET ROLE');
    await query('DELETE FROM private.film_studio_save_windows WHERE user_id=$1', [owner]);
    await actor(owner);
    for (let i = 0; i < 30; i++) await value(save, [project, 2 + i, raw, 'Film', `minute-save-${i}`]);
    await rejects(save, [project, 32, raw, 'Film', 'minute-save-30'], 'PT429', 'RATE_LIMITED');
    assert.equal((await value(save, [project, 31, raw, 'Film', 'minute-save-29'])).idempotent, true);
    await query('RESET ROLE');
    assert.equal(await value('SELECT minute_count FROM private.film_studio_save_windows WHERE user_id=$1', [owner]), 30);
    await query("UPDATE private.film_studio_save_windows SET minute_start=now()-interval '2 minutes' WHERE user_id=$1", [owner]);
    await actor(owner);
    assert.equal((await value(save, [project, 32, raw, 'Film', 'minute-reset'])).revision, 33);
    await query('ROLLBACK TO SAVEPOINT minute_cap');
  });
  await check('501st daily save is refused and the next daily window resets', async () => {
    await query('SAVEPOINT day_cap');
    await query('RESET ROLE');
    await query('UPDATE private.film_studio_save_windows SET minute_count=0,day_count=499 WHERE user_id=$1', [owner]);
    await actor(owner);
    assert.equal((await value(save, [project, 2, raw, 'Film', 'daily-save-500'])).revision, 3);
    await rejects(save, [project, 3, raw, 'Film', 'daily-save-501'], 'PT429', 'RATE_LIMITED');
    await query('RESET ROLE');
    await query("UPDATE private.film_studio_save_windows SET day_start=now()-interval '2 days' WHERE user_id=$1", [owner]);
    await actor(owner);
    assert.equal((await value(save, [project, 3, raw, 'Film', 'daily-reset'])).revision, 4);
    await query('ROLLBACK TO SAVEPOINT day_cap');
  });
  await check('remove requires matching revision; absent removal is idempotent', async () => {
    await rejects(remove, [project, 1], 'PT409', 'VERSION_CONFLICT');
    assert.deepEqual(await value(remove, [project, 2]), { removed: true });
    assert.deepEqual(await value(remove, [project, 2]), { removed: true, idempotent: true });
    assert.equal(Number(await value('SELECT count(id) FROM public.film_studio_projects WHERE id=$1', [project])), 0);
  });
  await check('Auth deletion cascades films and windows without affecting another account', async () => {
    await actor(other);
    const kept = await value(save, [null, 0, raw, 'Other', 'other-create']);
    await query('RESET ROLE');
    assert.ok(Number(await value('SELECT count(*) FROM public.film_studio_projects WHERE user_id=$1', [owner])) > 0);
    assert.equal(Number(await value('SELECT count(*) FROM private.film_studio_save_windows WHERE user_id=$1', [owner])), 1);
    await query('DELETE FROM auth.users WHERE id=$1', [owner]);
    assert.equal(Number(await value('SELECT count(*) FROM public.film_studio_projects WHERE user_id=$1', [owner])), 0);
    assert.equal(Number(await value('SELECT count(*) FROM private.film_studio_save_windows WHERE user_id=$1', [owner])), 0);
    assert.equal(Number(await value('SELECT count(*) FROM public.film_studio_projects WHERE id=$1', [kept.id])), 1);
  });
  console.log(`${checks} film studio cloud integration checks passed`);
} finally {
  await query('ROLLBACK');
  await db.end();
}
