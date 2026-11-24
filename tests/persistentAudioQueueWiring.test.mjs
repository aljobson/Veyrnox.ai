import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('web owned queue actions are gated and reuse the private asset boundary', () => {
  const queue = read('app/veyrnox/_components/music/MusicQueue.jsx');
  const save = read('app/veyrnox/_components/SaveToAudioShelfButton.js');
  const shelf = read('app/veyrnox/_components/AudioReferenceShelf.js');
  const mini = read('app/veyrnox/_components/music/MusicMiniPlayer.jsx');
  assert.match(queue, /privateOwnedAssetPath\(current\)/);
  assert.match(queue, /window\.addEventListener\('storage'/);
  assert.match(queue, /loaded\.current = false/);
  assert.match(queue, /canPersistAudioQueue\(loaded\.current/);
  assert.match(queue, /addEventListener\('canplay', play/);
  assert.match(queue, /resumePosition\.current = audioRef\.current\?\.currentTime/);
  assert.match(save, /queue\?\.ownedEnabled[\s\S]*Add to listening queue/);
  assert.match(shelf, /source:'audio_shelf'[\s\S]*Add to listening queue/);
  assert.match(mini, /queue\?\.ownedEnabled[\s\S]*queue\.playOwned/);
});

test('native queue is app-level, owner-fenced and wired to generated, owned and public audio', () => {
  const layout = read('apps/mobile/src/app/(app)/_layout.tsx');
  const provider = read('apps/mobile/src/components/music/PersistentAudioQueue.tsx');
  const store = read('apps/mobile/src/lib/music/persistentAudioQueue.ts');
  const create = read('apps/mobile/src/components/create/CreateResult.tsx');
  const owned = read('apps/mobile/src/app/(app)/music/[id].tsx');
  const publicTrack = read('apps/mobile/src/app/(app)/music/track/[slug].tsx');
  assert.match(layout, /<PersistentAudioQueueProvider>[\s\S]*<Stack[\s\S]*<\/PersistentAudioQueueProvider>/);
  assert.match(store, /userDocStorage/);
  assert.match(store, /subscribeCacheUser\(\(\) => persistentAudioQueueStore\.ownerChanged\(\)\)/);
  assert.match(provider, /features\.persistentQueue === true/);
  assert.match(provider, /publicEnabled: capability === 'on'/);
  assert.match(provider, /entitlements\.status === 'fulfilled'/);
  assert.match(provider, /12 \* 60_000/);
  assert.match(provider, /11 \* 60_000/);
  assert.match(provider, /isAudioFocusOwner\(focusId\)/);
  assert.match(provider, /AppState\.currentState !== 'active'/);
  assert.doesNotMatch(provider, /position: 'absolute'/);
  assert.match(provider, /useSafeAreaInsets/);
  assert.match(store, /await storage\.remove\(key\)/);
  assert.match(create, /file\?\.mime_type\.startsWith\('audio\/'\)[\s\S]*Add to listening queue/);
  assert.match(owned, /source: 'music'/);
  assert.match(publicTrack, /queue\.addPublic/);
});

test('native audio surfaces share one local focus coordinator', () => {
  for (const path of [
    'apps/mobile/src/lib/music/useMusicPlayer.ts',
    'apps/mobile/src/components/music/PublicPlayer.tsx',
    'apps/mobile/src/components/InlineMedia.tsx',
    'apps/mobile/src/components/music/PersistentAudioQueue.tsx',
  ]) assert.match(read(path), /claimAudioFocus/);
  assert.match(read('apps/mobile/src/lib/music/useMusicPlayer.ts'), /if \(!isAudioFocusOwner\(focusId\)\) return/);
});
