import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptSession, clearSession, getSession, getFreshAccessToken } from '../app/lib/authClient.js';
import { readJobHistory, pushJobHistory } from '../app/veyrnox/_lib/jobHistory.js';

const store = new Map();
globalThis.localStorage = {
  getItem: k => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  key: i => [...store.keys()][i],
  get length() { return store.size; },
};
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test';
const session = (id, expires_in = 3600) => ({ user: { id }, access_token: id, refresh_token: `refresh-${id}`, expires_in });
const job = { job_id: 'private-job', prompt: 'private prompt' };

test('invalidation removes cached prompts and the legacy unscoped history', () => {
  adoptSession(session('alice'));
  pushJobHistory(job);
  store.set('veyrnox_job_history_v1', JSON.stringify([job]));
  assert.equal(readJobHistory()[0].prompt, job.prompt);
  clearSession();
  assert.deepEqual(readJobHistory(), []);
  assert.equal([...store.keys()].some(k => k.startsWith('veyrnox_job_history')), false);
});

test('switching account cannot read prior prompts, even if old scoped data remains', () => {
  adoptSession(session('alice'));
  pushJobHistory(job);
  adoptSession(session('bob'));
  store.set('veyrnox_job_history_v2:alice', JSON.stringify([job]));
  assert.deepEqual(readJobHistory(), []);
  pushJobHistory({ job_id: 'bob-job' });
  assert.deepEqual(readJobHistory().map(j => j.job_id), ['bob-job']);
  clearSession();
});

test('anonymous history writes are discarded', () => {
  clearSession();
  pushJobHistory(job);
  assert.deepEqual(readJobHistory(), []);
});

test('refresh rejection after an account switch cannot invalidate the new account', async () => {
  adoptSession(session('alice', 10));
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  const pending = getFreshAccessToken();
  adoptSession(session('bob'));
  pushJobHistory({ job_id: 'bob-job' });
  release(Response.json({ error: 'invalid_grant' }, { status: 400 }));
  assert.equal(await pending, null);
  assert.equal(getSession().user.id, 'bob');
  assert.equal(readJobHistory()[0].job_id, 'bob-job');
  clearSession();
});

test('late gateway responses cannot populate the next account history', async () => {
  const { register } = await import('node:module');
  register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
    return next(s.endsWith('/authClient') ? s + '.js' : s, c);
  }`));
  const { gatewayFetch } = await import('../app/veyrnox/_lib/gateway.js');
  adoptSession(session('alice'));
  let release;
  globalThis.fetch = () => new Promise(resolve => { release = resolve; });
  const pending = gatewayFetch('/jobs');
  await new Promise(resolve => setImmediate(resolve));
  adoptSession(session('bob'));
  release(Response.json({ jobs: [job] }));
  await assert.rejects(pending, { code: 'account_changed' });
  assert.deepEqual(readJobHistory(), []);
  clearSession();
});
