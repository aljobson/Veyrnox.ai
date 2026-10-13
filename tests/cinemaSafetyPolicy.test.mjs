import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CINEMA_POLICY_VERSION, CINEMA_RATINGS, CINEMA_WARNING_CODES, cinemaSafetyPassed, validCinemaRating, validCinemaWarnings } from '../lib/cinema/safetyPolicy.js';

test('the Cinema policy uses Veyrnox audience labels and a versioned declaration', () => {
  assert.match(CINEMA_POLICY_VERSION, /^cinema-safety-\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(CINEMA_RATINGS.map(([code]) => code), ['ALL', 'PG', '12', '15', '18']);
  for (const code of CINEMA_RATINGS.map(([value]) => value)) assert.equal(validCinemaRating(code), true);
  for (const value of ['R', 'R18', 'UNRATED', '', null]) assert.equal(validCinemaRating(value), false);
});

test('warnings are allowlisted, distinct and bounded', () => {
  const all = CINEMA_WARNING_CODES.map(([code]) => code);
  assert.equal(validCinemaWarnings([]), true);
  assert.equal(validCinemaWarnings(all), true);
  for (const invalid of [['violence', 'violence'], ['nudity'], 'violence', [1], null]) assert.equal(validCinemaWarnings(invalid), false);
});

test('publication safety passes only when every required check passed', () => {
  const passed = { content_status: 'passed', child_safety_status: 'passed', malware_status: 'passed' };
  assert.equal(cinemaSafetyPassed(passed), true);
  for (const key of ['content_status', 'child_safety_status', 'malware_status']) {
    for (const value of ['pending', 'flagged', 'unavailable', undefined]) assert.equal(cinemaSafetyPassed({ ...passed, [key]: value }), false);
  }
});

test('the database is the fail-closed publication boundary and scan history is append-only', () => {
  const sql = readFileSync(new URL('../packages/db/schema/supabase/0294_cinema_safety_gate.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.cinema_safety_checks/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.cinema_safety_check_events/);
  assert.match(sql, /cinema_safety_check_events_append_only/);
  assert.match(sql, /cinema_safety_check_events_no_truncate/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION %s TO service_role/);
  assert.match(sql, /IF NOT FOUND OR 'pending'=ANY/);
  assert.match(sql, /ARRAY\['passed','passed','passed'\]/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[^\n]+TO (anon|authenticated)/);
});
