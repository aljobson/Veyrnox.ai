#!/usr/bin/env node
// 0353 (ADR-0135): block a Cinema member. Runs against the full migration replay (ledger-tests.yml).
// Everything runs in one transaction that is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('isolated local database required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0]?.value;
const rpc = (fn, ...args) => value(`SELECT public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS value`, args);
const refusedAs = async (role, sql, args = []) => {
  await c.query('SAVEPOINT r');
  try { await c.query(`SET LOCAL ROLE ${role}`); await c.query(sql, args); assert.fail(`${role} was allowed: ${sql}`); }
  catch (err) { assert.equal(err.code, '42501', err.message); }
  finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};
async function person(label) {
  const a = randomUUID();
  await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [a, `${a}@example.invalid`]);
  await rpc('create_cinema_profile', a, randomUUID(), { username: `b_${a.replaceAll('-', '').slice(0, 20)}`, display_name: label });
  const row = (await q('SELECT u.id, p.username FROM public.users u JOIN public.cinema_profiles p ON p.user_id=u.id WHERE u.auth_id=$1', [a]))[0];
  return { auth: a, id: row.id, username: row.username };
}

await c.query('BEGIN');
try {
  const sql = await readFile(new URL('../packages/db/schema/supabase/0353_cinema_user_blocks.sql', import.meta.url), 'utf8');
  // The migration replays cleanly: a second apply inside a savepoint changes nothing.
  await c.query(sql);
  await c.query('SAVEPOINT again'); await c.query(sql); await c.query('RELEASE SAVEPOINT again');

  const creator = await person('creator'), alice = await person('alice'), bob = await person('bob'), carol = await person('carol');
  await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=$1", [creator.id]);
  const content = await rpc('save_cinema_draft', creator.auth, randomUUID(), null, 0, {
    content_type: 'FILM', parent_id: null, position: null, title: 'Block fixture', synopsis: 'Test', language: 'en',
    categories: ['drama'], ai_disclosures: ['generated_script'],
  });
  await q("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC',published_at=now() WHERE id=$1", [content.id]);
  for (const who of [bob, carol])
    await q("INSERT INTO public.cinema_comments(author_id,content_id,body,status) VALUES($1,$2,$3,'approved')", [who.id, content.id, `from ${who.username}`]);
  const authors = async (viewer) => (await rpc('read_cinema_comments', viewer, content.id, null)).comments.map((x) => x.username).sort();

  // Before any block everyone sees both comments, signed in or not.
  assert.deepEqual(await authors(alice.auth), [bob.username, carol.username].sort());
  assert.deepEqual(await authors(null), [bob.username, carol.username].sort());

  // Block: first call creates, replay is a no-op that says so.
  assert.deepEqual(await rpc('block_cinema_user', alice.auth, bob.username), { ok: true, username: bob.username, already: false });
  assert.deepEqual(await rpc('block_cinema_user', alice.auth, bob.username), { ok: true, username: bob.username, already: true });
  assert.equal((await q('SELECT count(*)::int AS n FROM public.user_blocks WHERE blocker_id=$1', [alice.id]))[0].n, 1);

  // Filtering: only the blocker stops seeing the blocked member; nobody else is affected, and a block is one-way.
  assert.deepEqual(await authors(alice.auth), [carol.username]);
  assert.deepEqual(await authors(carol.auth), [bob.username, carol.username].sort());
  assert.deepEqual(await authors(bob.auth), [bob.username, carol.username].sort());
  assert.deepEqual(await authors(null), [bob.username, carol.username].sort());

  // The list names who is blocked, for the blocker only.
  const list = await rpc('list_blocked_cinema_users', alice.auth);
  assert.deepEqual(list.blocks.map((b) => b.username), [bob.username]);
  assert.deepEqual((await rpc('list_blocked_cinema_users', carol.auth)).blocks, []);

  // Refusals.
  assert.equal((await rpc('block_cinema_user', alice.auth, alice.username)).error, 'cannot_block_self');
  assert.equal((await rpc('block_cinema_user', alice.auth, 'no_such_member')).error, 'user_not_found');
  assert.equal((await rpc('block_cinema_user', alice.auth, 'Bad Name')).error, 'invalid_username');
  assert.equal((await rpc('block_cinema_user', randomUUID(), bob.username)).error, 'account_not_found');
  assert.equal((await rpc('list_blocked_cinema_users', randomUUID())).error, 'account_not_found');

  // Unblock: first removes, replay is a no-op; the comment comes back.
  assert.deepEqual(await rpc('unblock_cinema_user', alice.auth, bob.username), { ok: true, username: bob.username, already: false });
  assert.deepEqual(await rpc('unblock_cinema_user', alice.auth, bob.username), { ok: true, username: bob.username, already: true });
  assert.deepEqual(await authors(alice.auth), [bob.username, carol.username].sort());
  // Unblocking someone never blocked, or who does not exist, is the same no-op.
  assert.equal((await rpc('unblock_cinema_user', alice.auth, carol.username)).already, true);
  assert.equal((await rpc('unblock_cinema_user', alice.auth, 'no_such_member')).already, true);

  // Access control: no browser role reaches the table or any block function, and RLS is forced.
  const flags = (await q("SELECT relrowsecurity r, relforcerowsecurity f FROM pg_class WHERE oid='public.user_blocks'::regclass"))[0];
  assert.deepEqual([flags.r, flags.f], [true, true]);
  await rpc('block_cinema_user', alice.auth, bob.username);
  for (const role of ['anon', 'authenticated']) {
    await refusedAs(role, 'SELECT * FROM public.user_blocks');
    await refusedAs(role, 'INSERT INTO public.user_blocks(blocker_id,blocked_id) VALUES($1,$2)', [alice.id, carol.id]);
    await refusedAs(role, 'SELECT public.block_cinema_user($1,$2)', [alice.auth, carol.username]);
    await refusedAs(role, 'SELECT public.unblock_cinema_user($1,$2)', [alice.auth, bob.username]);
    await refusedAs(role, 'SELECT public.list_blocked_cinema_users($1)', [alice.auth]);
  }
  await refusedAs('service_role', 'SELECT * FROM public.user_blocks');
  await refusedAs('service_role', 'DELETE FROM public.user_blocks');
  // The table itself refuses a self block even to its owner.
  await c.query('SAVEPOINT s');
  await assert.rejects(c.query('INSERT INTO public.user_blocks(blocker_id,blocked_id) VALUES($1,$1)', [alice.id]), { code: '23514' });
  await c.query('ROLLBACK TO SAVEPOINT s');

  // A tombstoned account keeps no blocks, its own or against it.
  await rpc('block_cinema_user', bob.auth, alice.username);
  await q('UPDATE public.users SET deleted_at = now() WHERE id=$1', [bob.id]);
  assert.equal((await q('SELECT count(*)::int AS n FROM public.user_blocks WHERE blocker_id=$1 OR blocked_id=$1', [bob.id]))[0].n, 0);
  assert.equal((await rpc('block_cinema_user', alice.auth, bob.username)).error, 'user_not_found');

  console.log('cinema blocks: ok');
} finally {
  await c.query('ROLLBACK');
  await c.end();
}
