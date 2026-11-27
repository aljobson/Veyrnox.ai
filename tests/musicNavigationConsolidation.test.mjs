import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('workspace management is consolidated into Music Library', async () => {
  const [shell, libraryPage, library, legacyRoute] = await Promise.all([
    source('app/veyrnox/_components/music/MusicPreviewShell.jsx'),
    source('app/veyrnox/app/music/library/page.js'),
    source('app/veyrnox/_components/music/MusicServerLibrary.jsx'),
    source('app/veyrnox/app/music/workspaces/page.js'),
  ]);

  assert.doesNotMatch(shell, /label: 'Workspaces'/);
  assert.match(libraryPage, /collaborationEnabled=\{musicCollaborationEnabled\(\)\}/);
  assert.match(library, /collaborationEnabled \? <MusicWorkspaceCollaboration/);
  assert.doesNotMatch(library, /workspaceView/);
  assert.match(legacyRoute, /permanentRedirect\('\/app\/music\/library'\)/);
});

test('sound effects are exposed as a creation type instead of a primary destination', async () => {
  const [shell, create, sounds, creationTypes] = await Promise.all([
    source('app/veyrnox/_components/music/MusicPreviewShell.jsx'),
    source('app/veyrnox/_components/music/MusicCreateStudio.jsx'),
    source('app/veyrnox/app/music/sounds/page.js'),
    source('app/veyrnox/_components/music/MusicCreationTypeNav.jsx'),
  ]);

  assert.doesNotMatch(shell, /label: 'Sounds'/);
  assert.match(shell, /link\.key === 'create' && pathname === '\/app\/music\/sounds'/);
  assert.match(create, /MusicCreationTypeNav active="track"/);
  assert.match(sounds, /MusicCreationTypeNav active="sound-effect"/);
  assert.match(creationTypes, /What are you creating\?/);
  assert.match(creationTypes, /Full track/);
  assert.match(creationTypes, /Sound effect/);
});
