import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMessage, musicPushEnabled } from '../lib/pushNotifications.js';

const TOKEN = 'ExponentPushToken[abcdefgh1234]';

test('Music pushes never name the other person and only route to fixed-form paths', () => {
  for (const kind of ['music_follower', 'music_comment_approved', 'music_reply']) {
    const m = buildMessage({ kind, music_path: '/music/tracks/a1b2c3d4e5f60718293a4b5c' }, TOKEN);
    assert.equal(m.to, TOKEN);
    assert.equal(m.channelId, 'jobs');
    assert.deepEqual(m.data, { type: 'music', kind, path: '/music/tracks/a1b2c3d4e5f60718293a4b5c' });
    assert.doesNotMatch(`${m.title} ${m.body}`, /\{|undefined|null/);
  }
  assert.equal(buildMessage({ kind: 'music_reply', music_path: 'https://evil.test' }, TOKEN).data.path, undefined);
  assert.equal(buildMessage({ kind: 'job_done', job_id: 'x', modality: 'text-to-video' }, TOKEN).title, 'Your video is ready');
});

test('Music pushes need the push switch and the Music notifications switch, which ships false', async () => {
  assert.equal(musicPushEnabled({ PUSH_NOTIFICATIONS_ENABLED: 'true', MUSIC_RUNTIME_FLAGS: '{"notifications":true}' }), true);
  assert.equal(musicPushEnabled({ PUSH_NOTIFICATIONS_ENABLED: 'false', MUSIC_RUNTIME_FLAGS: '{"notifications":true}' }), false);
  assert.equal(musicPushEnabled({ PUSH_NOTIFICATIONS_ENABLED: 'true', MUSIC_RUNTIME_FLAGS: '{}' }), false);
  const wrangler = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  // Off in production; on in staging only (owner, 2026-11-15).
  assert.equal((wrangler.match(/\\"notifications\\":false/g) || []).length, 1);
  assert.equal((wrangler.match(/\\"notifications\\":true/g) || []).length, 1);
});

test('0536 fills the outbox from a sweep, dedupes by event key, honours blocks and keeps the job claim intact', async () => {
  const sql = await readFile(new URL('../packages/db/schema/supabase/0536_music_push_notifications.sql', import.meta.url), 'utf8');
  assert.match(sql, /interval '15 minutes'/);
  assert.match(sql, /ON CONFLICT \(music_event_key\) WHERE music_event_key IS NOT NULL DO NOTHING/);
  assert.match(sql, /public\.user_blocks b WHERE b\.blocker_id = e\.user_id AND b\.blocked_id = e\.actor/);
  assert.match(sql, /c\.status = 'approved'/);
  assert.match(sql, /LEFT JOIN public\.jobs j ON j\.id = o\.job_id/);
  assert.doesNotMatch(sql, /CREATE TRIGGER|ledger_|credit_balances/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO (authenticated|anon)/);
  const sweep = await readFile(new URL('../lib/pushNotifications.js', import.meta.url), 'utf8');
  assert.match(sweep, /musicPushEnabled\(env\)\s+\? await rpc\('push_enqueue_music_events'/);
});
