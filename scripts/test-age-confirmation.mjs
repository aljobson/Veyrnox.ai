#!/usr/bin/env node
// Disposable local full-replay database only. Fixtures and migration replay roll back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname)) throw Error('isolated local database required');
const c = new pg.Client({ connectionString:url });
await c.connect();
const one = async (sql,args=[]) => (await c.query(sql,args)).rows[0];
try {
  await c.query('BEGIN');
  // Supabase-owned auth fixture is absent from a fresh local migration replay.
  await c.query('CREATE TABLE IF NOT EXISTS auth.mfa_factors(user_id uuid,factor_type text,status text)');
  const migration = await readFile(new URL('../packages/db/schema/supabase/0425_age_confirmation.sql',import.meta.url),'utf8');
  const wrapper = await one("SELECT pg_get_functiondef('public.read_privacy_export_page(text,text,uuid,text,uuid,text,text,integer)'::regprocedure) AS definition");
  await c.query(migration);
  assert.deepEqual(await one("SELECT pg_get_functiondef('public.read_privacy_export_page(text,text,uuid,text,uuid,text,text,integer)'::regprocedure) AS definition"), wrapper, '0425 must preserve the voice-profile wrapper');
  const auth = randomUUID();
  await c.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ($1,$2,now())',[auth,`${auth}@test.invalid`]);
  const { id } = await one('SELECT id FROM public.users WHERE auth_id=$1',[auth]);
  const balance = await one('SELECT * FROM public.credit_balances WHERE user_id=$1',[id]);
  const ledger = await one('SELECT count(*) FROM public.ledger_entries WHERE user_id=$1',[id]);
  const confirm = async version => (await one('SELECT public.confirm_minimum_age($1,$2) AS r',[id,version])).r;
  const first = await confirm('age-18-v1');
  assert.equal(first.ok,true);
  assert.deepEqual(await confirm('age-18-v1'),first);
  assert.deepEqual(await confirm('age-18-v2'),first,'first version wins too');
  await c.query(migration);
  assert.deepEqual(await confirm('age-18-v2'),first,'migration replay preserves records');
  assert.equal((await confirm(null)).code,'VERSION_INVALID');
  for (const role of ['anon','authenticated']) {
    assert.equal((await one('SELECT has_function_privilege($1,$2,$3) AS allowed',[role,'public.confirm_minimum_age(uuid,text)','EXECUTE'])).allowed,false);
  }
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await one('SELECT has_function_privilege($1,$2,$3) AS allowed', [role, 'private.read_privacy_export_page_without_voice(text,text,uuid,text,uuid,text,text,integer)', 'EXECUTE'])).allowed, false);
  }
  assert.equal((await one("SELECT has_function_privilege('service_role','public.confirm_minimum_age(uuid,text)','EXECUTE') AS allowed")).allowed,true);
  const exp = (await one('SELECT public.start_privacy_export($1,$2) AS r',[auth,'aal1'])).r;
  assert.equal(exp.ok,true);
  const page = (await one("SELECT public.read_privacy_export_page($1,'aal1',$2,'profile',NULL,NULL,NULL,NULL) AS r",[auth,exp.export_id])).r;
  assert.equal(page.ok, true);
  for (const key of ['creator_profile', 'checkin_streak', 'voice_profiles']) assert.ok(Object.hasOwn(page.rows[0], key), `missing existing profile key: ${key}`);
  assert.deepEqual(page.rows[0].voice_profiles, []);
  assert.equal(page.rows[0].age_confirmation_version,first.version);
  assert.equal(new Date(page.rows[0].age_confirmed_at).getTime(),new Date(first.confirmed_at).getTime());
  const plan = (await one('SELECT public.prepare_account_deletion($1) AS r',[auth])).r;
  assert.equal(plan.eligible,true);
  const erased = (await one('SELECT public.erase_account($1,$2) AS r',[auth,plan.confirmation_token])).r;
  assert.equal(erased.ok,true);
  assert.deepEqual(await one('SELECT age_confirmed_at,age_confirmation_version FROM public.users WHERE id=$1',[id]),{age_confirmed_at:null,age_confirmation_version:null});
  assert.equal((await confirm('age-18-v1')).code,'USER_NOT_FOUND');
  assert.deepEqual(await one('SELECT * FROM public.credit_balances WHERE user_id=$1',[id]),balance);
  assert.deepEqual(await one('SELECT count(*) FROM public.ledger_entries WHERE user_id=$1',[id]),ledger);
  console.log('age confirmation: replay, first-write preservation, grants, export, deletion and unchanged credits passed');
} finally { await c.query('ROLLBACK'); await c.end(); }
