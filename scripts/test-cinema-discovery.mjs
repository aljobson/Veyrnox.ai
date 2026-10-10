// Disposable local database only: discoverable publication and voting privacy boundaries.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('isolated database required');
const c = new pg.Client({ connectionString: url }); await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0]?.value;
const page = (mode = 'all', limit = 24, before = null, beforeId = null, category = null) =>
  value('SELECT public.list_cinema_discovery($1,$2,$3,$4,$5) AS value', [mode, limit, before, beforeId, category]);
async function person(role) {
  const auth = randomUUID(); await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [auth, randomUUID(), { username: `d_${auth.replaceAll('-', '').slice(0, 20)}`, display_name: role }]);
  await q('UPDATE public.cinema_memberships SET role=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)', [auth, role]);
  const id = await value('SELECT id AS value FROM public.users WHERE auth_id=$1', [auth]); return { auth, id };
}
async function draft(creator, type = 'FILM', parent = null, position = null) {
  const result = await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [creator.auth, randomUUID(), null, 0,
    { content_type: type, parent_id: parent, position, title: `${type} ${randomUUID()}`, synopsis: 'Discovery fixture', language: 'en',
      ai_disclosures: ['generated_script'], categories: parent ? [] : ['drama'] }]);
  assert.ok(result.id, JSON.stringify(result)); return result.id;
}
const publish = id => q("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC',published_at='2026-10-10T10:00:00.123456Z' WHERE id=$1", [id]);
const upload = (creator, id) => q("INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid,duration_seconds) VALUES($1,$2,$3,100,$4,'ready',$5,90)", [id, creator.id, randomUUID(), randomUUID().replaceAll('-', '').padEnd(64, 'a'), randomUUID().replaceAll('-', '')]);
try {
  const sql = await readFile(new URL('../packages/db/schema/supabase/0277_cinema_public_discovery.sql', import.meta.url), 'utf8');
  await c.query(sql); await c.query(sql);
  await c.query('BEGIN');
  // Other acceptance scripts keep fixtures. Hide their titles inside this rollback only.
  await q("UPDATE public.cinema_content SET visibility='PRIVATE' WHERE lifecycle_status='PUBLISHED'");
  await q("UPDATE public.cinema_competitions SET status='closed' WHERE status='open'");
  const creator = await person('creator'), voter = await person('viewer'), other = await person('viewer'), admin = await person('administrator');
  const series = await draft(creator, 'SERIES'), season = await draft(creator, 'SEASON', series, 1), episode = await draft(creator, 'EPISODE', season, 1);
  const film = await draft(creator), privateFilm = await draft(creator), notReady = await draft(creator);
  for (const id of [film, privateFilm, notReady, episode]) if (id !== notReady) await upload(creator, id);
  for (const id of [series, season, episode, film, notReady]) await publish(id);
  const comp = randomUUID(); await q("INSERT INTO public.cinema_competitions(id,name,starts_at,ends_at,target_types,created_by) VALUES($1,'Discovery week',now()-interval '1 day',now()+interval '1 day',ARRAY['FILM','EPISODE'],$2)", [comp, admin.id]);
  let all = (await page()).titles;
  assert.deepEqual(new Set(all.map(t => t.id)), new Set([film, series]), 'only ready published root titles');
  assert.deepEqual((await page('series')).titles.map(t => t.id), [series]);
  assert.equal((await page('series')).titles[0].episode_count, 1);
  assert.equal((await page('all', 24, null, null, 'comedy')).titles.length, 0);
  const ballot = await value('SELECT public.cast_cinema_vote($1,$2,$3,$4) AS value', [voter.auth, randomUUID(), episode, comp]); assert.equal(ballot.status, 'qualified');
  await q("INSERT INTO public.cinema_votes(voter_id,content_id,competition_id,idempotency_key,status,risk_reason) VALUES($1,$2,$3,$4,'under_review','velocity')", [other.id, episode, comp, randomUUID()]);
  let voting = (await page('voting')).titles;
  assert.deepEqual(new Set(voting.map(t => t.id)), new Set([film, episode]), 'target types match current competitions');
  const ep = voting.find(t => t.id === episode); assert.equal(ep.root_id, series); assert.equal(ep.competitions[0].qualified_votes, 1);
  for (const forbidden of ['creator_id', 'stream_uid', 'voter_id', 'my_vote', 'risk_reason']) assert.equal(Object.hasOwn(ep, forbidden), false);
  assert.deepEqual(Object.keys(ep.competitions[0]).sort(), ['ends_at', 'id', 'name', 'qualified_votes']);
  await q("UPDATE public.cinema_memberships SET account_status='suspended' WHERE user_id=$1", [voter.id]);
  assert.equal((await page('voting')).titles.find(t => t.id === episode).competitions[0].qualified_votes, 0);
  await q("UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=$1", [voter.id]);
  await q('DELETE FROM auth.users WHERE id=$1', [voter.auth]);
  assert.equal((await page('voting')).titles.find(t => t.id === episode).competitions[0].qualified_votes, 0, 'current Auth is required for counted ballots');
  // Ties retain database microseconds and a UUID tie-breaker, without repeated rows.
  all = (await page()).titles; const ids = []; let at = null, id = null;
  for (let i = 0; i < all.length; i++) { const t = (await page('all', 1, at, id)).titles[0]; assert.ok(t); ids.push(t.id); at = t.published_at; id = t.id; }
  assert.deepEqual(ids, all.map(t => t.id)); assert.equal((await page('all', 1, at, id)).titles.length, 0);
  assert.ok(at.includes('123456'));
  for (const ancestor of [series, season]) {
    await q("UPDATE public.cinema_content SET visibility='PRIVATE' WHERE id=$1", [ancestor]);
    assert.ok(!(await page('voting')).titles.some(t => t.id === episode));
    assert.ok(!(await page('series')).titles.some(t => t.id === series));
    await q("UPDATE public.cinema_content SET visibility='PUBLIC' WHERE id=$1", [ancestor]);
  }
  await q("UPDATE public.cinema_uploads SET state='error' WHERE content_id=$1", [episode]);
  assert.ok(!(await page('voting')).titles.some(t => t.id === episode)); assert.equal((await page('series')).titles.length, 0);
  await q("UPDATE public.cinema_memberships SET account_status='suspended' WHERE user_id=$1", [creator.id]); assert.equal((await page()).titles.length, 0);
  await q("UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=$1", [creator.id]);
  await q("UPDATE public.cinema_competitions SET ends_at=now()-interval '1 second' WHERE id=$1", [comp]); assert.equal((await page('voting')).titles.length, 0);
  for (const args of [[null, 12], ['winners', 12], ['all', 0], ['all', 25], ['all', 12, at, null], ['all', 12, null, null, 'Bad']]) assert.equal((await page(...args)).error, 'invalid_query');
  const acl = (await q("SELECT p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') AS anon,has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated,has_function_privilege('service_role',p.oid,'EXECUTE') AS service FROM pg_proc p WHERE p.oid='public.list_cinema_discovery(text,integer,timestamptz,uuid,text)'::regprocedure"))[0];
  assert.equal(acl.prosecdef, true); assert.ok(acl.proconfig.includes('search_path=""')); assert.deepEqual([acl.anon, acl.authenticated, acl.service], [false, false, true]);
  const ledgerBefore = await value('SELECT count(*) AS value FROM public.ledger_entries'); await page(); await page('voting');
  assert.equal(await value('SELECT count(*) AS value FROM public.ledger_entries'), ledgerBefore);
  await c.query('ROLLBACK');
  console.log('Cinema discovery: ready/public ancestor privacy, series and competition filtering, current account/Auth counts, tied pagination, bounded inputs, service-only RPC and unchanged ledger pass.');
} finally { await c.query('ROLLBACK').catch(() => {}); await c.end(); }
