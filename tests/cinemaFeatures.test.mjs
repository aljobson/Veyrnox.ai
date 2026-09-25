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
  for (const key of ['profiles','creators','content','uploads','monetisation','voting','comments','ppv','premieres']) assert.equal(cinemaFeatures(env)[key], false);
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
