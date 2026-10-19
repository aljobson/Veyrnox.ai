import test from 'node:test';
import assert from 'node:assert/strict';
import { cinemaFeatures, CINEMA_FEATURE_FLAGS } from '../lib/cinema/features.js';

test('Cinema switches fail closed for absent, malformed and truthy values', () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1', ' true ', true, 1]) {
    const env = Object.fromEntries(Object.values(CINEMA_FEATURE_FLAGS).map(key => [key, 'true']));
    env.CINEMA_ENABLED = value;
    assert.ok(Object.values(cinemaFeatures(env)).every(v => v === false));
  }
  assert.equal(cinemaFeatures({ CINEMA_ENABLED: 'true' }).profiles, false);
  assert.equal(cinemaFeatures({ CINEMA_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'TRUE' }).profiles, false);
});
test('child switches cannot bypass profile, subscription or upload prerequisites', () => {
  const env = Object.fromEntries(Object.values(CINEMA_FEATURE_FLAGS).map(key => [key, 'true']));
  env.CINEMA_ENABLED = 'true';
  assert.ok(Object.values(cinemaFeatures(env)).every(v => v === true));
  env.SOCIAL_CINEMA_PROFILES_ENABLED = 'false';
  for (const key of ['profiles','creators','content','uploads','unlocks','publishing','monetisation','voting','retention','comments','storyPolls','ppv','premieres']) assert.equal(cinemaFeatures(env)[key], false);
  env.SOCIAL_CINEMA_PROFILES_ENABLED = 'true';
  env.CINEMA_SUBSCRIPTIONS_ENABLED = 'false';
  assert.equal(cinemaFeatures(env).monetisation, false);
  assert.equal(cinemaFeatures(env).ppv, false);
  env.CREATOR_UPLOADS_ENABLED = 'false';
  assert.equal(cinemaFeatures(env).premieres, false);
});
test('rollout state is immutable and re-evaluated per request', () => {
  const env = { CINEMA_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true' };
  const first = cinemaFeatures(env);
  assert.throws(() => { first.profiles = false; }, TypeError);
  env.CINEMA_ENABLED = 'false';
  assert.equal(cinemaFeatures(env).profiles, false);
  assert.equal(first.profiles, true);
  assert.ok(!JSON.stringify(first).includes('SECRET'));
});

test('private collections also require viewing to be open', () => {
  const env = Object.fromEntries(Object.values(CINEMA_FEATURE_FLAGS).map(key => [key, 'true']));
  env.CINEMA_ENABLED = 'true'; env.CINEMA_VIEWING_ENABLED = 'false';
  assert.equal(cinemaFeatures(env).retention, false);
});

test('CINEMA_RUNTIME_FLAGS carries the switches in one binding and gives the same answers as separate vars', () => {
  const names = Object.keys(CINEMA_FEATURE_FLAGS);
  const separate = { CINEMA_ENABLED: 'true' };
  const packed = { CINEMA_ENABLED: 'true', CINEMA_RUNTIME_FLAGS: JSON.stringify(Object.fromEntries(names.map(n => [n, 'true']))) };
  for (const n of names) separate[CINEMA_FEATURE_FLAGS[n]] = 'true';
  assert.deepEqual(cinemaFeatures(packed), cinemaFeatures(separate));
  // A partial pack matches the same partial set of separate vars; absent is off.
  const some = ['profiles', 'viewing', 'voting', 'rankings'];
  const partialPacked = { CINEMA_ENABLED: 'true', CINEMA_RUNTIME_FLAGS: JSON.stringify(Object.fromEntries(some.map(n => [n, 'true']))) };
  const partialSeparate = { CINEMA_ENABLED: 'true', ...Object.fromEntries(some.map(n => [CINEMA_FEATURE_FLAGS[n], 'true'])) };
  assert.deepEqual(cinemaFeatures(partialPacked), cinemaFeatures(partialSeparate));
  assert.equal(cinemaFeatures(partialPacked).rankings, true);
  assert.equal(cinemaFeatures(partialPacked).comments, false);
});

test('a separate var that is set is the rollback override over CINEMA_RUNTIME_FLAGS', () => {
  const flags = JSON.stringify({ profiles: 'true', viewing: 'true', voting: 'true' });
  const env = { CINEMA_ENABLED: 'true', CINEMA_RUNTIME_FLAGS: flags };
  assert.equal(cinemaFeatures(env).voting, true);
  assert.equal(cinemaFeatures({ ...env, VOTING_ENABLED: 'false' }).voting, false);
  assert.equal(cinemaFeatures({ ...env, SOCIAL_CINEMA_PROFILES_ENABLED: 'false' }).profiles, false);
});

test('CINEMA_RUNTIME_FLAGS fails closed: malformed, unknown key, non-string value, oversize, array, or CINEMA_ENABLED off', () => {
  const good = { profiles: 'true', viewing: 'true' };
  const base = { CINEMA_ENABLED: 'true' };
  assert.equal(cinemaFeatures({ ...base, CINEMA_RUNTIME_FLAGS: JSON.stringify(good) }).viewing, true);
  for (const bad of ['{', '[]', 'null', '"true"', JSON.stringify({ ...good, nope: 'true' }), JSON.stringify({ ...good, voting: true }),
    JSON.stringify({ ...good, voting: 'TRUE' }), JSON.stringify({ ...good, pad: 'x'.repeat(3000) }), undefined, 7]) {
    const f = cinemaFeatures({ ...base, CINEMA_RUNTIME_FLAGS: bad });
    assert.ok(Object.entries(f).every(([k, v]) => k === 'enabled' ? v === true : v === false), String(bad).slice(0, 40));
  }
  assert.ok(Object.values(cinemaFeatures({ CINEMA_RUNTIME_FLAGS: JSON.stringify(good) })).every(v => v === false), 'master switch still gates everything');
});
