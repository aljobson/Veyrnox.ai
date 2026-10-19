import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';
import { cinemaFeatures, CINEMA_FEATURE_FLAGS } from '../lib/cinema/features.js';

const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));

// The individual vars wrangler.jsonc carried before ADR-0145 (main at a77f191f), value for value. cinemaFeatures() must
// answer identically from these and from the grouped CINEMA_RUNTIME_FLAGS the file now carries.
const LEGACY = {
  production: {
    CREATOR_APPLICATIONS_ENABLED: 'true', CREATOR_CONTENT_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true', CREATOR_UPLOADS_ENABLED: 'true',
    CINEMA_SUBSCRIPTIONS_ENABLED: 'false', CINEMA_UNLOCKS_ENABLED: 'false', CINEMA_FREE_CEILING_ENABLED: 'true',
    CINEMA_PUBLISHING_ENABLED: 'true', CINEMA_VIEWING_ENABLED: 'true',
  },
  staging: {
    SOCIAL_CINEMA_PROFILES_ENABLED: 'true', CREATOR_APPLICATIONS_ENABLED: 'true', CREATOR_CONTENT_ENABLED: 'true', CREATOR_UPLOADS_ENABLED: 'true',
    CINEMA_UNLOCKS_ENABLED: 'true', CINEMA_SUBSCRIPTIONS_ENABLED: 'true', CINEMA_PUBLISHING_ENABLED: 'true', CINEMA_VIEWING_ENABLED: 'true',
    CINEMA_FREE_CEILING_ENABLED: 'true',
  },
};
const MOVED = Object.keys(LEGACY.production);

for (const [name, vars] of [['production', config.vars], ['staging', config.env.staging.vars]]) {
  test(`${name}: grouped Cinema flags give the same cinemaFeatures() as the old individual vars`, () => {
    assert.equal(vars.CINEMA_ENABLED, 'true', 'CINEMA_ENABLED stays its own var');
    for (const key of MOVED) assert.equal(Object.hasOwn(vars, key), false, `${key} moved into CINEMA_RUNTIME_FLAGS`);
    const before = cinemaFeatures({ CINEMA_ENABLED: 'true', ...LEGACY[name] });
    assert.deepEqual(cinemaFeatures(vars), before);
    assert.equal(JSON.stringify(cinemaFeatures(vars)), JSON.stringify(before), 'byte for byte');
  });
  test(`${name}: the group names only known switches and turns on nothing new`, () => {
    const group = JSON.parse(vars.CINEMA_RUNTIME_FLAGS);
    const legacyOn = new Set(Object.entries(LEGACY[name]).filter(([, v]) => v === 'true').map(([k]) => k));
    for (const [key, value] of Object.entries(group)) {
      assert.ok(Object.hasOwn(CINEMA_FEATURE_FLAGS, key), `${key} is a Cinema switch`);
      assert.equal(value === 'true', legacyOn.has(CINEMA_FEATURE_FLAGS[key]), key);
    }
    assert.equal(Object.keys(group).length, MOVED.length);
  });
}

const base = { CINEMA_ENABLED: 'true', CINEMA_RUNTIME_FLAGS: JSON.stringify({ profiles: 'true', viewing: 'true', voting: 'true' }) };
test('the group enables a switch, and an individual var wins over it either way', () => {
  assert.equal(cinemaFeatures(base).voting, true);
  assert.equal(cinemaFeatures({ ...base, VOTING_ENABLED: 'false' }).voting, false);
  const off = { CINEMA_ENABLED: 'true', CINEMA_RUNTIME_FLAGS: JSON.stringify({ profiles: 'true', voting: 'false' }) };
  assert.equal(cinemaFeatures(off).voting, false);
  assert.equal(cinemaFeatures({ ...off, VOTING_ENABLED: 'true' }).voting, true);
});
test('CINEMA_ENABLED still gates the group', () => {
  assert.ok(Object.values(cinemaFeatures({ ...base, CINEMA_ENABLED: 'false' })).every((v) => v === false));
  assert.ok(Object.values(cinemaFeatures({ CINEMA_RUNTIME_FLAGS: base.CINEMA_RUNTIME_FLAGS })).every((v) => v === false));
});
test('a malformed group turns the whole group off', () => {
  const bad = [
    '', 'not json', '[]', 'null', '"true"', '{"profiles":true}', '{"profiles":"TRUE"}', '{"profiles":"1"}',
    '{"profiles":"true","bogus":"true"}', '{"__proto__":"true"}', JSON.stringify({ profiles: 'true', pad: 'x'.repeat(3000) }),
  ];
  for (const value of bad) {
    const f = cinemaFeatures({ CINEMA_ENABLED: 'true', CINEMA_RUNTIME_FLAGS: value });
    assert.ok(Object.entries(f).every(([k, v]) => k === 'enabled' || v === false), value);
  }
  assert.equal(cinemaFeatures({ CINEMA_ENABLED: 'true', CINEMA_RUNTIME_FLAGS: { profiles: 'true' } }).profiles, false);
});
