// Disposable local database only: automatic poster source privacy and series selection.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(databaseUrl).hostname)) throw Error('isolated database required');
const db = new pg.Client({ connectionString: databaseUrl });
await db.connect();
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => (await rows(sql, args))[0]?.value;
const source = (auth, content) => value('SELECT public.read_cinema_poster_source($1,$2) AS value', [auth, content]);

async function creator() {
  const auth = randomUUID();
  await rows('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [auth, randomUUID(), { username: `p_${auth.replaceAll('-', '').slice(0, 20)}`, display_name: 'Poster creator' }]);
  await rows("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [auth]);
  return { auth, id: await value('SELECT id AS value FROM public.users WHERE auth_id=$1', [auth]) };
}
async function draft(person, type, parent = null, position = null) {
  const result = await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [person.auth, randomUUID(), null, 0,
    { content_type: type, parent_id: parent, position, title: `${type} poster`, synopsis: '', language: 'en', ai_disclosures: ['generated_video'], categories: parent ? [] : ['drama'] }]);
  assert.ok(result.id, JSON.stringify(result));
  return result.id;
}
async function upload(person, content, marker) {
  const uid = marker.repeat(32);
  await rows("INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid,duration_seconds,width,height) VALUES($1,$2,$3,100,$4,'ready',$5,80,1280,720)",
    [content, person.id, randomUUID(), marker.repeat(64), uid]);
  return uid;
}

try {
  const migration = await readFile(new URL('../packages/db/schema/supabase/0292_cinema_poster_sources.sql', import.meta.url), 'utf8');
  await db.query(migration); await db.query(migration);
  await db.query('BEGIN');
  await rows("UPDATE public.cinema_content SET visibility='PRIVATE' WHERE lifecycle_status='PUBLISHED'");
  const owner = await creator(), stranger = await creator();
  const film = await draft(owner, 'FILM'), privateFilm = await draft(owner, 'SHORT');
  const series = await draft(owner, 'SERIES'), season = await draft(owner, 'SEASON', series, 1), episode = await draft(owner, 'EPISODE', season, 1);
  const filmUid = await upload(owner, film, 'a'), privateUid = await upload(owner, privateFilm, 'b'), episodeUid = await upload(owner, episode, 'c');
  await rows("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC',published_at=now() WHERE id=ANY($1)", [[film, series, season, episode]]);

  assert.deepEqual(await source(null, film), { stream_uid: filmUid, duration_seconds: 80 });
  assert.deepEqual(await source(null, episode), { stream_uid: episodeUid, duration_seconds: 80 });
  assert.deepEqual(await source(null, series), { stream_uid: episodeUid, duration_seconds: 80 });
  assert.deepEqual(await source(owner.auth, privateFilm), { stream_uid: privateUid, duration_seconds: 80 });
  assert.equal((await source(null, privateFilm)).error, 'poster_not_found');
  assert.equal((await source(stranger.auth, privateFilm)).error, 'poster_not_found');
  await rows("UPDATE public.cinema_content SET visibility='PRIVATE' WHERE id=$1", [season]);
  assert.equal((await source(null, series)).error, 'poster_not_found');
  assert.equal((await source(null, episode)).error, 'poster_not_found');

  const acl = (await rows("SELECT p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') AS service FROM pg_proc p WHERE p.oid='public.read_cinema_poster_source(text,uuid)'::regprocedure"))[0];
  assert.equal(acl.prosecdef, true); assert.ok(acl.proconfig.includes('search_path=""'));
  assert.deepEqual([acl.anon, acl.authenticated, acl.service], [false, false, true]);
  await db.query('ROLLBACK');
  console.log('Cinema posters: private ownership, public ancestry, series episode selection, migration replay and service-only ACL passed.');
} finally {
  await db.query('ROLLBACK').catch(() => {});
  await db.end();
}
