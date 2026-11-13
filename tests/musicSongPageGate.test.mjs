import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { musicLibraryEnabled, musicUiEnabled } from '../lib/musicBackend.js';

const root = new URL('../', import.meta.url).pathname;
const flags = (patch) => JSON.stringify({ ui: true, schema: true, library: true, ...patch });

test('the song page picks the server view from MUSIC_RUNTIME_FLAGS, like the Library page', () => {
  const source = readFileSync(path.join(root, 'app/veyrnox/app/music/songs/[id]/page.js'), 'utf8');
  assert.match(source, /import \{ musicLibraryEnabled, musicUiEnabled \} from '[./]*lib\/musicBackend\.js'/);
  assert.match(source, /const serverLibrary = musicUiEnabled\(\) && musicLibraryEnabled\(\);/);
  const library = readFileSync(path.join(root, 'app/veyrnox/app/music/library/page.js'), 'utf8');
  assert.match(library, /musicUiEnabled\(\) && musicLibraryEnabled\(\)/);
});

test('the shared gate is on with the JSON flags alone and off when any needed flag is false', () => {
  const on = { MUSIC_RUNTIME_FLAGS: flags({}) };
  assert.equal(musicUiEnabled(on) && musicLibraryEnabled(on), true);
  for (const off of [{ ui: false }, { schema: false }, { library: false }]) {
    const env = { MUSIC_RUNTIME_FLAGS: flags(off) };
    assert.equal(musicUiEnabled(env) && musicLibraryEnabled(env), false, JSON.stringify(off));
  }
});

test('no app page reads a legacy MUSIC_*_ENABLED variable directly', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full); continue; }
      if (!/\.(js|jsx|mjs)$/.test(name)) continue;
      if (/process\.env\.MUSIC_[A-Z_]+_ENABLED/.test(readFileSync(full, 'utf8'))) offenders.push(path.relative(root, full));
    }
  };
  walk(path.join(root, 'app'));
  assert.deepEqual(offenders, [], 'read the flag through lib/musicBackend.js so MUSIC_RUNTIME_FLAGS is honoured');
});
