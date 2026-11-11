import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeMusicReferenceUrl,
  parseMusicReferenceCreate,
  parseMusicReferenceDelete,
  resolveMusicReference,
} from '../lib/musicReferenceLinks.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0493_music_reference_links.sql', import.meta.url);
const deletionGuardUrl = new URL('../packages/db/schema/supabase/0490_music_account_deletion_guard.sql', import.meta.url);
const routeUrl = new URL('../app/api/v1/music/reference-links/route.js', import.meta.url);
const componentUrl = new URL('../app/veyrnox/_components/music/MusicReferenceImporter.jsx', import.meta.url);

test('reference URL normalization accepts canonical public YouTube and SoundCloud tracks only', () => {
  assert.deepEqual(normalizeMusicReferenceUrl('https://youtu.be/dQw4w9WgXcQ?si=tracking'), {
    ok: true,
    provider: 'youtube',
    externalId: 'dQw4w9WgXcQ',
    canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  });
  assert.deepEqual(normalizeMusicReferenceUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), {
    ok: true,
    provider: 'youtube',
    externalId: 'dQw4w9WgXcQ',
    canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  });
  assert.deepEqual(normalizeMusicReferenceUrl('https://soundcloud.com/Artist_Name/Track-Slug?si=tracking'), {
    ok: true,
    provider: 'soundcloud',
    externalId: 'artist_name/track-slug',
    canonicalUrl: 'https://soundcloud.com/artist_name/track-slug',
  });
  assert.equal(normalizeMusicReferenceUrl('https://soundcloud.com/artist/s-town-theme').ok, true);
  for (const value of [
    'http://youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ',
    'https://soundcloud.com/discover/music',
    'https://soundcloud.com/artist/sets',
    'https://soundcloud.com/artist/likes',
    'https://soundcloud.com/artist/tracks',
    'https://soundcloud.com/artist/followers',
    'https://soundcloud.com/artist/private/s-secret',
    'https://example.com/track',
  ]) assert.equal(normalizeMusicReferenceUrl(value).ok, false, value);
});

test('reference create parser keeps inspiration separate from explicit owned rights', () => {
  const base = {
    url: 'https://youtu.be/dQw4w9WgXcQ',
    rights_mode: 'inspiration',
    rights_confirmed: false,
    idempotency_key: 'music-reference.12345678',
  };
  assert.equal(parseMusicReferenceCreate(base).rightsMode, 'inspiration');
  assert.equal(parseMusicReferenceCreate({ ...base, rights_mode: 'owned_or_licensed' }).error, 'rights_confirmation_required');
  assert.equal(parseMusicReferenceCreate({ ...base, rights_mode: 'owned_or_licensed', rights_confirmed: true }).rightsMode, 'owned_or_licensed');
  assert.equal(parseMusicReferenceCreate({ ...base, extra: true }).error, 'invalid_request');
  assert.equal(parseMusicReferenceDelete({ id: 'a5ed2d0d-8276-4fbb-9c4f-39f401a3158b' }).ok, true);
  assert.equal(parseMusicReferenceDelete({ id: 'not-an-id' }).error, 'reference_id_invalid');
});

test('resolver requests only official oEmbed endpoints and returns minimal safe metadata', async () => {
  const reference = normalizeMusicReferenceUrl('https://youtu.be/dQw4w9WgXcQ');
  let requested;
  const resolved = await resolveMusicReference(reference, { fetchImpl: async (url, options) => {
    requested = { url, options };
    return new Response(JSON.stringify({
      title: 'Public track title',
      author_name: 'Public creator',
      provider_name: 'YouTube',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      html: '<iframe src="https://malicious.invalid"></iframe>',
    }), { headers: { 'content-type': 'application/json', 'content-length': '260' } });
  } });
  assert.equal(new URL(requested.url).origin, 'https://www.youtube.com');
  assert.equal(new URL(requested.url).pathname, '/oembed');
  assert.equal(requested.options.cache, 'no-store');
  assert.equal(requested.options.redirect, 'error');
  assert.deepEqual(resolved, {
    ok: true,
    provider: 'youtube',
    externalId: 'dQw4w9WgXcQ',
    canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    title: 'Public track title',
    creator: 'Public creator',
    thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&playsinline=1',
  });
  assert.equal(Object.hasOwn(resolved, 'audioUrl'), false);
});

test('SoundCloud resolver accepts only its official player and forces autoplay off', async () => {
  const reference = normalizeMusicReferenceUrl('https://soundcloud.com/artist/track');
  const resolved = await resolveMusicReference(reference, { fetchImpl: async () => new Response(JSON.stringify({
    title: 'Track', author_name: 'Artist', provider_name: 'SoundCloud',
    thumbnail_url: 'https://i1.sndcdn.com/artworks-example-large.jpg',
    html: '<iframe src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/1&amp;auto_play=true"></iframe>',
  }), { headers: { 'content-type': 'application/json' } }) });
  assert.equal(resolved.ok, true);
  assert.equal(new URL(resolved.embedUrl).hostname, 'w.soundcloud.com');
  assert.equal(new URL(resolved.embedUrl).searchParams.get('auto_play'), 'false');

  const urnTrack = await resolveMusicReference(reference, { fetchImpl: async () => Response.json({
    title: 'URN track', author_name: 'Artist', provider_name: 'SoundCloud',
    html: '<iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2Fsoundcloud%253Atracks%253A2"></iframe>',
  }) });
  assert.equal(urnTrack.ok, true);

  const rejected = await resolveMusicReference(reference, { fetchImpl: async () => new Response(JSON.stringify({
    title: 'Track', author_name: 'Artist', provider_name: 'SoundCloud',
    html: '<iframe src="https://evil.test/player"></iframe>',
  }), { headers: { 'content-type': 'application/json' } }) });
  assert.deepEqual(rejected, { ok: false, error: 'reference_metadata_invalid' });
  const wrongPath = await resolveMusicReference(reference, { fetchImpl: async () => Response.json({
    title: 'Track', author_name: 'Artist', provider_name: 'SoundCloud',
    html: '<iframe src="https://w.soundcloud.com/not-a-player/"></iframe>',
  }) });
  assert.deepEqual(wrongPath, { ok: false, error: 'reference_metadata_invalid' });
  const playlistWidget = await resolveMusicReference(reference, { fetchImpl: async () => Response.json({
    title: 'Collection', author_name: 'Artist', provider_name: 'SoundCloud',
    html: '<iframe src="https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Fplaylists%2F1"></iframe>',
  }) });
  assert.deepEqual(playlistWidget, { ok: false, error: 'reference_metadata_invalid' });
});

test('resolver fails closed for oversized, non-JSON and unavailable metadata', async () => {
  const reference = normalizeMusicReferenceUrl('https://youtu.be/dQw4w9WgXcQ');
  const oversized = await resolveMusicReference(reference, { fetchImpl: async () => new Response('{}', {
    headers: { 'content-type': 'application/json', 'content-length': '70000' },
  }) });
  assert.equal(oversized.error, 'reference_metadata_invalid');
  const html = await resolveMusicReference(reference, { fetchImpl: async () => new Response('<html></html>', {
    headers: { 'content-type': 'text/html' },
  }) });
  assert.equal(html.error, 'reference_metadata_invalid');
  const timedOut = await resolveMusicReference(reference, { fetchImpl: async () => { throw new DOMException('Timed out', 'TimeoutError'); } });
  assert.equal(timedOut.error, 'reference_upstream_timeout');
  const streamed = await resolveMusicReference(reference, { fetchImpl: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(65 * 1024)); controller.close(); },
  }), { headers: { 'content-type': 'application/json' } }) });
  assert.equal(streamed.error, 'reference_metadata_invalid');
  const realTimeout = await resolveMusicReference(reference, {
    timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  assert.equal(realTimeout.error, 'reference_upstream_timeout');
});

test('resolver distinguishes unavailable, private, missing and rate-limited tracks', async () => {
  const reference = normalizeMusicReferenceUrl('https://youtu.be/dQw4w9WgXcQ');
  for (const [status, error] of [[400, 'reference_not_found'], [401, 'reference_not_embeddable'], [403, 'reference_not_embeddable'], [404, 'reference_not_found'], [410, 'reference_not_found'], [429, 'reference_upstream_rate_limited'], [500, 'reference_upstream_unavailable']]) {
    const resolved = await resolveMusicReference(reference, { fetchImpl: async () => new Response('', { status }) });
    assert.equal(resolved.error, error, String(status));
  }
  const mismatch = await resolveMusicReference(reference, { fetchImpl: async () => Response.json({
    title: 'Track', author_name: 'Creator', provider_name: 'SoundCloud',
  }) });
  assert.equal(mismatch.error, 'reference_metadata_invalid');
  let cancelled = false;
  const bad = await resolveMusicReference(reference, { fetchImpl: async () => new Response(new ReadableStream({
    cancel() { cancelled = true; },
  }), { status: 400 }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(bad.error, 'reference_not_found');
  assert.equal(cancelled, true, 'non-success provider bodies are cancelled immediately');
});

test('migration is owner-scoped, service-only and stores metadata URLs rather than media bytes', async () => {
  const [sql, priorGuard] = await Promise.all([readFile(migrationUrl, 'utf8'), readFile(deletionGuardUrl, 'utf8')]);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.music_reference_links/);
  assert.match(sql, /REFERENCES public\.users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /r\.relname <> 'music_reference_links'/);
  assert.match(sql, /music_reference_links_forget_erased_user/);
  assert.match(sql, /AFTER UPDATE OF deleted_at ON public\.users/);
  assert.match(sql, /music_get_reference_link_by_idempotency/);
  assert.match(sql, /count\(\*\)[\s\S]*>= 200/);
  assert.match(sql, /ORDER BY created_at DESC, id DESC[\s\S]*LIMIT 200/);
  assert.match(sql, /UNIQUE \(user_id, provider, external_id\)/);
  assert.match(sql, /music_delete_reference_link[\s\S]*WHERE id = p_id AND user_id = v_user/);
  assert.match(sql, /FORCE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.music_reference_links FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /to_regprocedure\('public\.telemetry_path_allowed_pre_0493\(text\)'\) IS NULL/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.telemetry_path_allowed/);
  assert.doesNotMatch(sql, /audio_url|BYTEA|r2_key/i);
  const functionPattern = /CREATE OR REPLACE FUNCTION private\.account_deletion_blockers[\s\S]*?END \$\$;/;
  const previous = priorGuard.match(functionPattern)?.[0];
  const replacement = sql.match(functionPattern)?.[0].replace("\n       AND r.relname <> 'music_reference_links'", '');
  assert.equal(replacement, previous, 'the approved replacement changes only the reference-link exclusion');
});

test('API and UI preserve provider playback, attribution and owned-master boundary', async () => {
  const [route, component] = await Promise.all([readFile(routeUrl, 'utf8'), readFile(componentUrl, 'utf8')]);
  assert.match(route, /resolveMusicReference\(parsed, \{ signal: request\.signal \}\)/);
  assert.match(route, /accountReadLimit/);
  assert.match(route, /socialPostWriteLimit/);
  assert.match(route, /'Cache-Control': 'no-store'/);
  assert.match(component, /Bring a YouTube or SoundCloud link/);
  assert.match(component, /getSession, getStoredUserId, onSessionChange/);
  assert.match(component, /if \(!sessionUserId \|\| !referencesEnabled\) return undefined/);
  assert.match(component, /if \(!referencesEnabled\) return null/);
  assert.match(component, /Browse freely\. Sign in only when you want to save a private source link\./);
  assert.match(component, /veyrnox:auth-required/);
  assert.match(component, /Sign in to save/);
  assert.match(component, /official \$\{provider\} player/);
  assert.doesNotMatch(component, /autoplay', '1'|auto_play', 'true'/);
  assert.match(component, /This media is never sent to generation/);
  assert.match(component, /Upload owned master/);
  assert.match(component, /Confirm remove/);
  assert.doesNotMatch(component, /Sample this track|Download audio/);
});
