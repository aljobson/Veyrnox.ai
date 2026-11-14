import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { editorJobHandoffFromUrl } from '../app/veyrnox/_lib/editorMedia.mjs';

const JOB = '123e4567-e89b-42d3-a456-426614174000';
const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Veyrnox Edit accepts only a bounded private job handoff', () => {
  assert.deepEqual(editorJobHandoffFromUrl(`https://veyrnox.ai/app/editor?job=${JOB}&name=Night%20Drive`), {
    jobId: JOB,
    name: 'Night Drive',
  });
  assert.equal(editorJobHandoffFromUrl('https://veyrnox.ai/app/editor?job=../../secret'), null);
  assert.equal(editorJobHandoffFromUrl('not a url?job=missing'), null);
  assert.equal(editorJobHandoffFromUrl(`?job=${JOB}&name=${encodeURIComponent(`A\u0000  ${'b'.repeat(100)}`)}`).name.length, 80);
});

test('completed Music versions expose a direct account-checked Edit handoff', async () => {
  const [actions, library, detail, route] = await Promise.all([
    source('app/veyrnox/_components/music/MusicSongActions.jsx'),
    source('app/veyrnox/_components/music/MusicServerLibrary.jsx'),
    source('app/veyrnox/_components/music/MusicServerSongDetail.jsx'),
    source('app/api/v1/music/songs/[id]/route.js'),
  ]);
  assert.match(actions, /\/app\/editor\?job=\$\{encodeURIComponent\(jobId\)\}&name=\$\{encodeURIComponent\(title\)\}/);
  assert.match(actions, /Open in Veyrnox\.ai Edit/);
  assert.match(library, /jobId=\{song\.job_id\}[\s\S]*open_editor/);
  assert.match(detail, /jobId=\{song\.job_id\}/);
  assert.match(route, /isUuid\(result\.song\?\.job_id \|\| ''\) \? \['open_editor'\] : \[\]/);
});

test('both editor modes consume the handoff through the existing private Library loader', async () => {
  const [legacy, multitrack] = await Promise.all([
    source('app/veyrnox/app/editor/page.js'),
    source('app/veyrnox/_components/editor/MultitrackWorkspace.js'),
  ]);
  for (const editor of [legacy, multitrack]) {
    assert.match(editor, /editorJobHandoffFromUrl\(window\.location\.href\)/);
    assert.match(editor, /loadLibraryBlob\(gatewayFetch,\s*handoff\.jobId\)/);
    assert.match(editor, /libraryMediaId\(handoff\.jobId\)/);
    assert.match(editor, /url\.searchParams\.delete\('job'\)/);
  }
  assert.match(multitrack, /draftCandidate!==null/);
});
