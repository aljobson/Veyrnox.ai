import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
const id = 'e40439d1-646a-4c11-9c12-69fa3a851234';
Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
let saved, link, nextError = null, cap = false;
const song = { id, version_id: id, job_id: id, title: 'A'.repeat(80) };
globalThis.beatSeedFixture = {
  getStoredUserId: () => 'owner',
  gatewayFetch: async () => { if (nextError) throw nextError; return song; },
  loadSong: async base => ({ asset: { ...base, durationSec: 12, sourceChannels: 2, encodedBytes: 4000 } }),
  createBeat: async (doc, cloud) => { saved = doc; link = cloud; return cap ? { error: 'limit' } : { persistent: true }; },
};
const hooks = registerHooks({
  resolve(specifier, context, next) { return next(specifier === 'next/navigation' ? 'next/navigation.js' : specifier, context); },
  load(url, context, next) {
    const match = Object.entries({ '/gateway.js': 'gatewayFetch', '/authClient.js': 'getStoredUserId', '/beatSongAsset.js': 'loadSong', '/beatStore.js': 'createBeat' }).find(([suffix]) => url.endsWith(suffix));
    return match ? { format: 'module', shortCircuit: true, source: `export const { ${match[1]} } = globalThis.beatSeedFixture;` } : next(url, context);
  },
});
const { seedSongBeat } = await import('../app/veyrnox/_components/music/beat/useBeatSongSeed.js');
test.after(() => { hooks.deregister(); delete navigator.onLine; delete globalThis.beatSeedFixture; });
test('song seeding creates one valid audio track at bar 1 and an optional cloud sync link', async () => {
  for (const cloud of [false, true]) {
    const result = await seedSongBeat(id, cloud);
    assert.equal(result, saved.id); assert.equal(validateBeat(saved).ok, true);
    assert.equal(saved.title, song.title); assert.equal(saved.tracks.length, 1); assert.equal(saved.tracks[0].id, 't1');
    assert.equal(saved.tracks[0].kind, 'audio'); assert.equal(saved.tracks[0].regions[0].start, 0);
    assert.equal(Object.values(saved.assets)[0].ref.versionId, song.version_id);
    assert.equal(link?.userId, cloud ? 'owner' : undefined); assert.equal(link?.revision, cloud ? 0 : undefined);
  }
});
test('seed errors preserve ownership, connection and project-cap messages', async () => {
  for (const status of [403, 404]) {
    nextError = { status }; await assert.rejects(seedSongBeat(id, false), /belongs to another account or was deleted/);
  }
  nextError = { code: 'network_error' }; await assert.rejects(seedSongBeat(id, false), /needs a connection/);
  nextError = null; cap = true; await assert.rejects(seedSongBeat(id, false), /50 beats/); cap = false;
});
