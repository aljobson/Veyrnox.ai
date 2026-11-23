import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MUSIC_ACTION_SOURCE_LIMITS, musicActionLimitReason, musicActionOverLimit,
} from '../app/veyrnox/_lib/music/actionLimits.js';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('browser action limits equal the server constants the routes enforce', async () => {
  const backend = await source('lib/musicBackend.js');
  const constant = (name) => Number(backend.match(new RegExp(`export const ${name} = (\\d+);`))[1]);
  assert.deepEqual({ ...MUSIC_ACTION_SOURCE_LIMITS }, {
    cover: constant('MUSIC_COVER_DURATION_MAX'),
    extend: constant('MUSIC_EXTEND_DURATION_MAX'),
    add_section: constant('MUSIC_ADD_SECTION_SOURCE_MAX'),
    target_stem: constant('MUSIC_TARGET_STEM_DURATION_MAX'),
    add_track: constant('MUSIC_TRACK_ADD_SOURCE_MAX'),
    replace_section: constant('MUSIC_REPLACE_DURATION_MAX'),
  });
});

test('a 135 s song is over every 120 s action and Replace; a 60 s song fits all; unknown length never blocks', () => {
  for (const action of ['cover', 'extend', 'add_section', 'target_stem', 'add_track']) {
    assert.equal(musicActionOverLimit(action, 135), 120, action);
    assert.equal(musicActionOverLimit(action, 120), null, action);
    assert.equal(musicActionOverLimit(action, 60), null, action);
  }
  assert.equal(musicActionOverLimit('replace_section', 61), 60);
  assert.equal(musicActionOverLimit('replace_section', 60.02), 60, 'strict, like the server');
  assert.equal(musicActionOverLimit('replace_section', 60), null);
  assert.equal(musicActionOverLimit('extend', 120.01), 120, 'strict, like the server');
  for (const unknown of [null, undefined, NaN, Infinity, 0]) {
    assert.equal(musicActionOverLimit('extend', unknown), null);
  }
  assert.equal(musicActionOverLimit('stems', 999), null, 'actions without a length limit are never blocked');
});

test('reasons are short, single-line limits with no advice that may not work', () => {
  assert.equal(musicActionLimitReason(120), 'up to 2 min');
  assert.equal(musicActionLimitReason(60), 'up to 60 s');
});

test('the menu shows over-limit actions as disabled with a reason, and the song page passes the measured length', async () => {
  const menu = await source('app/veyrnox/_components/music/MusicSongActions.jsx');
  for (const action of ['cover', 'extend', 'add_section', 'target_stem', 'add_track', 'replace_section']) {
    assert.match(menu, new RegExp(`<LimitedMenuItem ref=\\{[^}]*\\} action="${action}"`), action);
  }
  assert.match(menu, /aria-disabled="true"/);
  assert.match(menu, /musicActionLimitReason\(limit\)/);
  assert.doesNotMatch(menu, /Crop this song first|flex-col/, 'no misleading advice; the item stays one line tall');
  const crop = await source('app/veyrnox/_components/music/MusicCropDialog.jsx');
  const render = await source('app/veyrnox/_components/music/MusicRenderDialog.jsx');
  assert.match(crop, /source_too_large'\?'This recording is too large to crop here/);
  assert.match(render, /source_too_large: 'This recording is too large to edit here/);
  const renderRoute = await source('app/api/v1/music/songs/[id]/render/route.js');
  assert.match(renderRoute, /context\.mime_type !== 'audio\/wav' \|\| Number\(context\.size_bytes\) > 26_214_400/);
  assert.match(renderRoute, /error: 'edit_unavailable_for_format' \}, 409/);
  for (const route of ['crop', 'render']) {
    const code = await source(`app/api/v1/music/songs/[id]/${route}/route.js`);
    assert.match(code, /error ?=== ?'upload_too_large' ?\? ?'source_too_large' ?: ?'source_duration_unavailable'/, route);
  }
  const page = await source('app/veyrnox/_components/music/MusicServerSongDetail.jsx');
  assert.match(page, /onLoadedMetadata=\{\(event\) => setMeasuredSource\(\{ url: playbackUrl/);
  assert.match(page, /sourceDurationSeconds=\{measuredSource\.url === playbackUrl \? measuredSource\.seconds : null\}/);
});
