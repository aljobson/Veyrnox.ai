import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptSession } from '../app/lib/authClient.js';

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: 'https://auth.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test' });
const TOKEN = 'a'.repeat(64);

async function load() {
  adoptSession({ access_token: 'tok', expires_in: 3600, user: { id: 'u1' } });
  return import('../app/veyrnox/_lib/accountDeletion.js');
}

test('prepare: flag off (404 not_found) reads as unavailable', async () => {
  const { prepareDeletion } = await load();
  globalThis.fetch = async () => Response.json({ error: 'not_found' }, { status: 404 });
  assert.deepEqual(await prepareDeletion(), { state: 'unavailable' });
});

test('prepare: eligible returns the token and the forfeited credits', async () => {
  const { prepareDeletion } = await load();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/v1/account/deletion');
    assert.equal(init.method, 'POST');
    return Response.json({ eligible: true, forfeit: { credits: 42, free_credits: 0 }, confirmation_token: TOKEN, expires_at: 'soon' });
  };
  assert.deepEqual(await prepareDeletion(), { state: 'ready', token: TOKEN, credits: 42, expiresAt: 'soon' });
});

test('prepare: blockers are passed through and no token is exposed', async () => {
  const { prepareDeletion } = await load();
  globalThis.fetch = async () => Response.json({ eligible: false, forfeit: { credits: 5 }, blockers: ['active_subscription'] });
  assert.deepEqual(await prepareDeletion(), { state: 'blocked', blockers: ['active_subscription'], credits: 5 });
});

test('confirm: sends DELETE with only the confirmation token', async () => {
  const { confirmDeletion } = await load();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), '/api/v1/account');
    assert.equal(init.method, 'DELETE');
    assert.deepEqual(JSON.parse(init.body), { confirmation_token: TOKEN });
    return Response.json({ deleted: true, replayed: false });
  };
  assert.equal((await confirmDeletion(TOKEN)).deleted, true);
});

test('confirm: deletion_blocked keeps the blocker list on the error body', async () => {
  const { confirmDeletion } = await load();
  globalThis.fetch = async () => Response.json({ error: 'deletion_blocked', blockers: ['projects_present'] }, { status: 409 });
  await assert.rejects(confirmDeletion(TOKEN), e => e.code === 'deletion_blocked' && e.body.blockers[0] === 'projects_present');
});
