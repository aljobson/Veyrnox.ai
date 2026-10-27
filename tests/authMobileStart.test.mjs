import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://project.supabase.test/';
process.env.PUBLIC_HOST = 'https://veyrnox.test';
const { GET } = await import('../app/auth/mobile/start/route.js');

const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const call = (query) => GET(new Request(`https://evil.test/auth/mobile/start${query}`));

test('the start route sends Google sign-in to Supabase with a fixed return address', () => {
  const res = call(`?provider=google&code_challenge=${CHALLENGE}&redirect_to=https://evil.test&next=x`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  const target = new URL(res.headers.get('location'));
  assert.equal(target.origin + target.pathname, 'https://project.supabase.test/auth/v1/authorize');
  assert.deepEqual(Object.fromEntries(target.searchParams), {
    provider: 'google',
    redirect_to: 'https://veyrnox.test/auth/mobile',
    code_challenge: CHALLENGE,
    code_challenge_method: 's256',
    prompt: 'select_account',
  });
});

test('Apple sign-in gets no account-chooser hint', () => {
  const target = new URL(call(`?provider=apple&code_challenge=${CHALLENGE}`).headers.get('location'));
  assert.equal(target.searchParams.get('provider'), 'apple');
  assert.equal(target.searchParams.get('prompt'), null);
});

test('the start route refuses unknown providers and malformed challenges', async () => {
  for (const query of ['', `?provider=github&code_challenge=${CHALLENGE}`, '?provider=google', '?provider=google&code_challenge=short', `?provider=google&code_challenge=${CHALLENGE}%0d%0a`, `?provider=google&code_challenge=${'a'.repeat(129)}`]) {
    const res = call(query);
    assert.equal(res.status, 400, query);
    assert.equal(res.headers.get('location'), null, query);
    assert.deepEqual(await res.json(), { error: 'invalid_request' }, query);
  }
});
