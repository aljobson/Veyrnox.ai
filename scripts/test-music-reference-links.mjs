#!/usr/bin/env node
// Run after replay-migrations on a throwaway LOCAL PostgreSQL only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must identify a throwaway local test database');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) {
  throw new Error('Music reference tests refuse remote databases and non-test database names');
}
const db = new pg.Client({ connectionString });
await db.connect();
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
const call = (name, args) => value(`SELECT public.${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) AS value`, args);

try {
  await db.query('BEGIN');
  const alice = randomUUID();
  const bob = randomUUID();
  for (const auth of [alice, bob]) {
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, `${auth}@example.invalid`]);
  }
  const id = randomUUID();
  const key = 'music-reference.integration';
  const args = [alice, id, 'youtube', 'dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'Public track', 'Public creator', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&playsinline=1', 'inspiration', key];

  const created = await call('music_create_reference_link', args);
  assert.equal(created.ok, true);
  assert.equal(created.idempotent, false);
  assert.deepEqual(await call('music_create_reference_link', args), { ...created, idempotent: true });
  assert.equal((await call('music_get_reference_link_by_idempotency', [alice, key])).link.id, id);
  assert.equal((await call('music_get_reference_link_by_idempotency', [bob, key])).found, false);
  assert.equal((await call('music_list_reference_links', [alice])).links.length, 1);
  assert.deepEqual((await call('music_list_reference_links', [bob])).links, []);
  assert.equal((await call('music_delete_reference_link', [bob, id])).ok, false);
  assert.equal((await call('music_list_reference_links', [alice])).links.length, 1);

  const conflict = [...args];
  conflict[3] = 'M7lc1UVf-VE';
  assert.equal((await call('music_create_reference_link', conflict)).code, 'IDEMPOTENCY_CONFLICT');
  const duplicate = [...args];
  duplicate[1] = randomUUID(); duplicate[10] = 'music-reference.integration-duplicate';
  assert.equal((await call('music_create_reference_link', duplicate)).code, 'ALREADY_SAVED');

  const aliceUserId = await value('SELECT id FROM public.users WHERE auth_id=$1', [alice]);
  const blockers = await value('SELECT private.account_deletion_blockers($1,$2) AS value', [aliceUserId, alice]);
  assert.equal(blockers.includes('music_content_present'), false);

  await db.query('SAVEPOINT denied');
  await db.query('SET LOCAL ROLE authenticated');
  await assert.rejects(call('music_list_reference_links', [alice]), (error) => error.code === '42501');
  await db.query('ROLLBACK TO SAVEPOINT denied');

  const prepared = await call('prepare_account_deletion', [alice]);
  assert.equal(prepared.eligible, true, JSON.stringify(prepared));
  assert.equal((await call('erase_account', [alice, prepared.confirmation_token])).ok, true);
  assert.equal(Number(await value('SELECT count(*) FROM public.music_reference_links WHERE user_id=$1', [aliceUserId])), 0);
  console.log('Music reference links: owner isolation, idempotency, account erasure and grants passed');
} finally {
  await db.query('ROLLBACK');
  await db.end();
}
