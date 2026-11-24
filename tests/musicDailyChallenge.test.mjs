import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MUSIC_DAILY_CHALLENGE_DESCRIPTORS, musicDailyChallengeAt, musicDailyChallengeForId,
} from '../lib/musicDailyChallenge.js';
import musicEnglish from '../lib/i18n/musicEnglish.mjs';

test('the UTC day deterministically selects one versioned reward-free challenge', () => {
  const a = musicDailyChallengeAt('2026-11-24T00:00:00.000Z');
  const b = musicDailyChallengeAt('2026-11-24T23:59:59.999Z');
  assert.deepEqual(a, b);
  assert.match(a.id, /^v1:2026-11-24:[a-z0-9-]+$/);
  assert.equal(a.date, '2026-11-24');
  assert.equal(a.reset_at, '2026-11-25T00:00:00.000Z');
  assert.equal(a.no_reward, true);
  assert.ok(MUSIC_DAILY_CHALLENGE_DESCRIPTORS.some(key => a.id.endsWith(`:${key}`)));
});

test('UTC midnight changes the dated id and rejects the previous day even after a catalog cycle', () => {
  const before = musicDailyChallengeAt('2026-11-24T23:59:59.999Z');
  const after = musicDailyChallengeAt('2026-11-25T00:00:00.000Z');
  assert.notEqual(before.id, after.id);
  assert.equal(musicDailyChallengeForId(before.id, '2026-11-25T00:00:00.000Z'), null);
  const sameDescriptorLater = musicDailyChallengeAt('2026-12-01T12:00:00.000Z');
  assert.equal(before.title_key, sameDescriptorLater.title_key);
  assert.notEqual(before.id, sameDescriptorLater.id);
  assert.equal(musicDailyChallengeForId(before.id, '2026-12-01T12:00:00.000Z'), null);
});

test('selection follows the instant, not DST or international-date-line wall clocks', () => {
  assert.equal(musicDailyChallengeAt('2026-03-29T00:30:00+00:00').date, '2026-03-29');
  assert.equal(musicDailyChallengeAt('2026-03-29T02:30:00+02:00').date, '2026-03-29');
  assert.equal(musicDailyChallengeAt('2026-11-24T00:30:00+14:00').date, '2026-11-23');
  assert.equal(musicDailyChallengeAt('2026-11-24T23:30:00-12:00').date, '2026-11-25');
});

test('only the exact current id resolves', () => {
  const now = '2026-11-24T12:00:00.000Z';
  const current = musicDailyChallengeAt(now);
  assert.deepEqual(musicDailyChallengeForId(current.id, now), current);
  for (const bad of [undefined, null, 4, '', 'v2:2026-11-24:x', 'v1:2026-11-24:../x', `${current.id}-changed`]) {
    assert.equal(musicDailyChallengeForId(bad, now), null);
  }
  assert.throws(() => musicDailyChallengeAt('not-a-date'), /invalid_challenge_instant/);
});

test('server order, mobile allowlist and both English catalogs cannot drift within v1', () => {
  const mobileContract = readFileSync(new URL('../apps/mobile/src/lib/music/dailyChallenge.ts', import.meta.url), 'utf8');
  const mobileEnglish = readFileSync(new URL('../apps/mobile/src/lib/i18n/messages/en/music.ts', import.meta.url), 'utf8');
  const block = /MUSIC_DAILY_CHALLENGE_DESCRIPTOR_KEYS = \[([\s\S]*?)\] as const;/.exec(mobileContract)?.[1] || '';
  const mobileKeys = [...block.matchAll(/'([a-z0-9]+(?:-[a-z0-9]+)*)'/g)].map(match => match[1]);
  assert.deepEqual(mobileKeys, [...MUSIC_DAILY_CHALLENGE_DESCRIPTORS]);
  for (const key of MUSIC_DAILY_CHALLENGE_DESCRIPTORS) {
    for (const suffix of ['title', 'prompt']) {
      const catalogKey = `music.dailyChallenge.prompt.${key}.${suffix}`;
      assert.equal(typeof musicEnglish[catalogKey], 'string', `web ${catalogKey}`);
      assert.match(mobileEnglish, new RegExp(`['\"]${catalogKey.replaceAll('.', '\\.')}['\"]\\s*:`), `mobile ${catalogKey}`);
    }
  }
  assert.match(mobileContract, /cross-platform drift test enforces it/);
  assert.match(readFileSync(new URL('../lib/musicDailyChallenge.js', import.meta.url), 'utf8'), /requires a catalog-version bump/);
});

test('web handoff is flag-gated, simple-only and cannot be replaced by the saved public draft', () => {
  const createPage = readFileSync(new URL('../app/veyrnox/app/music/create/page.js', import.meta.url), 'utf8');
  const serverStudio = readFileSync(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  const previewStudio = readFileSync(new URL('../app/veyrnox/_components/music/MusicCreateStudio.jsx', import.meta.url), 'utf8');
  assert.match(createPage, /musicRuntimeFlag\('dailyChallenge'\)[\s\S]*musicDailyChallengeForId\(rawChallenge\)/);
  assert.match(createPage, /!sampleSeed && !licensedTemplate/);
  assert.match(serverStudio, /!sampleSeed && !licensedTemplate && !challengeSeed && restored/);
  assert.match(serverStudio, /resolveInitialDescription\(\{ sampleSeed, licensedTemplate, challengePrompt, savedPrompt:/);
  assert.match(serverStudio, /const \[mode, setMode\] = useState\('simple'\)/);
  assert.doesNotMatch(serverStudio, /custom\.(?:set|change|update)[^(]*\([^)]*challenge/i);
  assert.match(previewStudio, /resolveInitialDescription\(\{ sampleSeed, licensedTemplate, challengePrompt \}\)/);
});
