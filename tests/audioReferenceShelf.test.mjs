import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  audioEngineFit,
  auditOwnedAudioReferences,
  createAudioShelfManifest,
  fetchOwnedAudioReference,
  filterAudioReferences,
  importOwnedAudioShelfManifest,
  loadOwnedAudioComparison,
  parseAudioShelfManifest,
  readAudioDuration,
  readAudioListeningSets,
  readAudioReferenceShelf,
  readAudioVoiceRecipes,
  readPinnedAudioReferenceIds,
  readSignatureVoiceRecipeIds,
  removeAudioReference,
  removeAudioListeningSet,
  saveAudioReference,
  saveAudioListeningSet,
  sortAudioReferences,
  toggleSignatureVoiceRecipe,
  toggleAudioComparison,
  togglePinnedAudioReference,
  updateAudioReferenceMetadata,
} from '../app/veyrnox/_lib/audioReferenceShelf.js';
import { DEFAULT_TTS_SETTINGS } from '../app/veyrnox/_lib/textToSpeech.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('Audio Reference Shelf stores only account-scoped owned job metadata', () => {
  const local = storage();
  const saved = saveAudioReference(local, 'account-a', {
    jobId: 'job-owned-audio-123',
    name: 'Ana dialogue take',
    purpose: 'lip-sync-dialogue',
    url: 'https://temporary.example/signed-secret',
    bytes: 'audio payload',
    script: 'private words',
  }, 'audio-ref-one');
  assert.deepEqual(saved, [{ id: 'audio-ref-one', jobId: 'job-owned-audio-123', name: 'Ana dialogue take', purpose: 'lip-sync-dialogue' }]);
  assert.doesNotMatch(JSON.stringify(saved), /temporary\.example|signed-secret|audio payload|private words/);
  assert.deepEqual(readAudioReferenceShelf(local, 'account-b'), []);
  assert.deepEqual(readAudioReferenceShelf(local, ''), []);
});

test('saving the same audio updates one entry and removal never deletes the Library asset', () => {
  const local = storage();
  saveAudioReference(local, 'account-a', { jobId: 'job-owned-audio-123', name: 'First name', purpose: 'lip-sync-dialogue' }, 'audio-ref-one');
  const updated = saveAudioReference(local, 'account-a', { jobId: 'job-owned-audio-123', name: 'Approved dub', purpose: 'dubbing-localisation' }, 'audio-ref-two');
  assert.deepEqual(updated, [{ id: 'audio-ref-one', jobId: 'job-owned-audio-123', name: 'Approved dub', purpose: 'dubbing-localisation' }]);
  assert.deepEqual(removeAudioReference(local, 'account-a', 'audio-ref-one'), []);
});

test('Shelf Curator edits only local name and purpose while preserving the owned job and Voice Recipe', () => {
  const local = storage();
  saveAudioReference(local, 'account-a', {
    jobId: 'job-owned-audio-123',
    name: 'Rough take',
    purpose: 'timing-rhythm',
    voiceRecipe: DEFAULT_TTS_SETTINGS,
  }, 'audio-ref-editable');
  const updated = updateAudioReferenceMetadata(local, 'account-a', 'audio-ref-editable', {
    name: '  Approved presenter take  ',
    purpose: 'narration-presenter',
    traits: ['calm', 'energetic', 'playful', 'dramatic', 'invalid-trait', 'calm'],
    jobId: 'job-attacker-audio-999',
    voiceRecipe: { voice: 'cloned-person' },
    url: 'https://secret.example/audio',
  });
  assert.deepEqual(updated, [{
    id: 'audio-ref-editable',
    jobId: 'job-owned-audio-123',
    name: 'Approved presenter take',
    purpose: 'narration-presenter',
    traits: ['calm', 'energetic', 'playful'],
    voiceRecipe: DEFAULT_TTS_SETTINGS,
  }]);
  assert.doesNotMatch(JSON.stringify(updated), /attacker|cloned-person|secret\.example|invalid-trait/);
  assert.deepEqual(updateAudioReferenceMetadata(local, 'account-b', 'audio-ref-editable', { name: 'Cross account', purpose: 'lip-sync-dialogue' }), []);
  assert.deepEqual(updateAudioReferenceMetadata(local, 'account-a', 'audio-ref-editable', { name: '', purpose: 'invalid' }), updated);
});

test('Audio Shelf keeps only a validated stock Voice Recipe beside owned audio', () => {
  const local = storage();
  const saved = saveAudioReference(local, 'account-a', {
    jobId: 'job-owned-audio-123',
    name: 'Weekly presenter',
    purpose: 'narration-presenter',
    voiceRecipe: { ...DEFAULT_TTS_SETTINGS, script: 'must not persist', sample: 'voice bytes' },
  }, 'audio-ref-recipe');
  assert.deepEqual(saved, [{
    id: 'audio-ref-recipe',
    jobId: 'job-owned-audio-123',
    name: 'Weekly presenter',
    purpose: 'narration-presenter',
    voiceRecipe: DEFAULT_TTS_SETTINGS,
  }]);
  assert.doesNotMatch(JSON.stringify(saved), /must not persist|voice bytes/);

  const updated = saveAudioReference(local, 'account-a', {
    jobId: 'job-owned-audio-123', name: 'Renamed', purpose: 'character-performance',
  }, 'audio-ref-unused');
  assert.deepEqual(updated[0].voiceRecipe, DEFAULT_TTS_SETTINGS);
  assert.equal(saveAudioReference(storage(), 'account-a', {
    jobId: 'job-owned-audio-456', name: 'Unsafe', purpose: 'narration-presenter',
    voiceRecipe: { ...DEFAULT_TTS_SETTINGS, voice: 'cloned-person' },
  }, 'audio-ref-unsafe')[0].voiceRecipe, undefined);
  saveAudioReference(local, 'account-a', {
    jobId: 'job-owned-audio-789', name: 'Plain audio', purpose: 'timing-rhythm',
  }, 'audio-ref-plain');
  assert.deepEqual(readAudioVoiceRecipes(local, 'account-a').map((item) => item.id), ['audio-ref-recipe']);
  assert.deepEqual(readAudioVoiceRecipes(local, 'account-b'), []);
});

test('Signature Voice Set keeps at most three current account recipes', () => {
  const local = storage();
  for (let index = 1; index <= 4; index += 1) {
    saveAudioReference(local, 'account-a', {
      jobId: `job-owned-signature-${index}`,
      name: `Signature ${index}`,
      purpose: 'narration-presenter',
      voiceRecipe: DEFAULT_TTS_SETTINGS,
    }, `audio-ref-signature-${index}`);
  }
  assert.deepEqual(toggleSignatureVoiceRecipe(local, 'account-a', 'audio-ref-signature-1'), ['audio-ref-signature-1']);
  toggleSignatureVoiceRecipe(local, 'account-a', 'audio-ref-signature-2');
  toggleSignatureVoiceRecipe(local, 'account-a', 'audio-ref-signature-3');
  assert.deepEqual(toggleSignatureVoiceRecipe(local, 'account-a', 'audio-ref-signature-4'), [
    'audio-ref-signature-3', 'audio-ref-signature-2', 'audio-ref-signature-1',
  ]);
  assert.deepEqual(readSignatureVoiceRecipeIds(local, 'account-b'), []);
  assert.deepEqual(toggleSignatureVoiceRecipe(local, 'account-a', 'audio-ref-missing'), [
    'audio-ref-signature-3', 'audio-ref-signature-2', 'audio-ref-signature-1',
  ]);
  removeAudioReference(local, 'account-a', 'audio-ref-signature-3');
  assert.deepEqual(readSignatureVoiceRecipeIds(local, 'account-a'), ['audio-ref-signature-2', 'audio-ref-signature-1']);
  assert.deepEqual(toggleSignatureVoiceRecipe(local, 'account-a', 'audio-ref-signature-2'), ['audio-ref-signature-1']);
});

test('Cue Pins keep up to six current-account references independent of Voice Recipes', () => {
  const local = storage();
  for (let index = 1; index <= 7; index += 1) {
    saveAudioReference(local, 'account-a', {
      jobId: `job-owned-cue-${index}`,
      name: `Cue ${index}`,
      purpose: index === 1 ? 'cleared-song' : 'timing-rhythm',
    }, `audio-ref-cue-${index}`);
    togglePinnedAudioReference(local, 'account-a', `audio-ref-cue-${index}`);
  }
  assert.deepEqual(readPinnedAudioReferenceIds(local, 'account-a'), [
    'audio-ref-cue-6', 'audio-ref-cue-5', 'audio-ref-cue-4', 'audio-ref-cue-3', 'audio-ref-cue-2', 'audio-ref-cue-1',
  ]);
  assert.deepEqual(readPinnedAudioReferenceIds(local, 'account-b'), []);
  assert.deepEqual(togglePinnedAudioReference(local, 'account-a', 'audio-ref-missing'), readPinnedAudioReferenceIds(local, 'account-a'));
  removeAudioReference(local, 'account-a', 'audio-ref-cue-6');
  assert.equal(readPinnedAudioReferenceIds(local, 'account-a').includes('audio-ref-cue-6'), false);
  assert.equal(togglePinnedAudioReference(local, 'account-a', 'audio-ref-cue-5').includes('audio-ref-cue-5'), false);
});

test('Audio Shelf Finder filters validated references by name, purpose, and Voice Recipe', () => {
  const recipe = {
    id: 'audio-ref-narrator', jobId: 'job-owned-narrator-123', name: 'Weekly narrator',
    purpose: 'narration-presenter', voiceRecipe: DEFAULT_TTS_SETTINGS,
  };
  const dialogue = {
    id: 'audio-ref-dialogue', jobId: 'job-owned-dialogue-123', name: 'Scene seven take',
    purpose: 'lip-sync-dialogue', traits: ['conversational', 'dramatic'],
  };
  const song = {
    id: 'audio-ref-song', jobId: 'job-owned-song-123', name: 'Licensed chorus',
    purpose: 'cleared-song',
  };
  const items = [recipe, dialogue, song, { unsafe: true }];
  assert.deepEqual(filterAudioReferences(items, { query: 'weekly' }), [recipe]);
  assert.deepEqual(filterAudioReferences(items, { query: 'dialogue' }), [dialogue]);
  assert.deepEqual(filterAudioReferences(items, { purpose: 'cleared-song' }), [song]);
  assert.deepEqual(filterAudioReferences(items, { voiceRecipesOnly: true }), [recipe]);
  assert.deepEqual(filterAudioReferences(items, { trait: 'conversational' }), [dialogue]);
  assert.deepEqual(filterAudioReferences(items, { query: 'dramatic' }), [dialogue]);
  assert.deepEqual(filterAudioReferences(items, { trait: 'invalid-trait' }), [recipe, dialogue, song]);
  assert.deepEqual(filterAudioReferences(items, { pinnedOnly: true, pinnedIds: ['audio-ref-song'] }), [song]);
  assert.deepEqual(filterAudioReferences(items, { pinnedOnly: true, pinnedIds: ['bad/id'] }), []);
  const healthById = { 'audio-ref-narrator': 'available', 'audio-ref-dialogue': 'unavailable' };
  assert.deepEqual(filterAudioReferences(items, { healthById, healthStatus: 'available' }), [recipe]);
  assert.deepEqual(filterAudioReferences(items, { healthById, healthStatus: 'unavailable' }), [dialogue]);
  assert.deepEqual(filterAudioReferences(items, { healthById, healthStatus: 'unchecked' }), [song]);
  assert.deepEqual(filterAudioReferences(items, { healthById, healthStatus: 'bad-state' }), [recipe, dialogue, song]);
  assert.deepEqual(filterAudioReferences(items, { purpose: 'bad-purpose' }), [recipe, dialogue, song]);
  assert.deepEqual(filterAudioReferences(null), []);
});

test('Shelf Views sort normalized references without changing stored order', () => {
  const items = [
    { id: 'audio-ref-zulu', jobId: 'job-sort-audio-001', name: 'Zulu take', purpose: 'timing-rhythm' },
    { id: 'audio-ref-alpha', jobId: 'job-sort-audio-002', name: 'Alpha take', purpose: 'lip-sync-dialogue' },
    { id: 'audio-ref-beta', jobId: 'job-sort-audio-003', name: 'Beta take', purpose: 'character-performance' },
  ];
  assert.deepEqual(sortAudioReferences(items).map((item) => item.id), ['audio-ref-zulu', 'audio-ref-alpha', 'audio-ref-beta']);
  assert.deepEqual(sortAudioReferences(items, { sortBy: 'name' }).map((item) => item.id), ['audio-ref-alpha', 'audio-ref-beta', 'audio-ref-zulu']);
  assert.deepEqual(sortAudioReferences(items, { sortBy: 'purpose' }).map((item) => item.id), ['audio-ref-beta', 'audio-ref-alpha', 'audio-ref-zulu']);
  assert.deepEqual(sortAudioReferences(items, {
    sortBy: 'health',
    healthById: { 'audio-ref-zulu': 'available', 'audio-ref-alpha': 'unavailable', 'audio-ref-beta': 'invalid' },
  }).map((item) => item.id), ['audio-ref-alpha', 'audio-ref-beta', 'audio-ref-zulu']);
  assert.deepEqual(sortAudioReferences(items, { sortBy: 'invalid' }).map((item) => item.id), ['audio-ref-zulu', 'audio-ref-alpha', 'audio-ref-beta']);
  assert.deepEqual(items.map((item) => item.id), ['audio-ref-zulu', 'audio-ref-alpha', 'audio-ref-beta']);
});

test('Reference Listening Board selection is bounded, unique, and removable', () => {
  let selected = toggleAudioComparison([], 'audio-ref-one');
  selected = toggleAudioComparison(selected, 'audio-ref-two');
  selected = toggleAudioComparison(selected, 'audio-ref-two');
  assert.deepEqual(selected, ['audio-ref-one']);
  selected = toggleAudioComparison(selected, 'audio-ref-two');
  selected = toggleAudioComparison(selected, 'audio-ref-three');
  assert.deepEqual(toggleAudioComparison(selected, 'audio-ref-four'), selected);
  assert.deepEqual(toggleAudioComparison(selected, 'bad/id'), selected);
  assert.deepEqual(toggleAudioComparison(null, 'audio-ref-one'), ['audio-ref-one']);
});

test('timing-aware comparison isolates unavailable audio and derives live engine fit in memory', async () => {
  const items = [
    { id: 'audio-ref-short', jobId: 'job-compare-short-123', name: 'Short take', purpose: 'lip-sync-dialogue' },
    { id: 'audio-ref-long', jobId: 'job-compare-long-123', name: 'Long take', purpose: 'narration-presenter' },
    { id: 'audio-ref-gone', jobId: 'job-compare-gone-123', name: 'Gone take', purpose: 'timing-rhythm' },
  ];
  const rows = await loadOwnedAudioComparison(async (path) => {
    if (path.includes('job-compare-gone-123')) throw new Error('not owned');
    return path.endsWith('/asset')
      ? { url: `https://assets.example/${path.includes('short') ? 'short' : 'long'}.wav`, mime_type: 'audio/wav' }
      : { state: 'succeeded' };
  }, items, async (url) => url.includes('short') ? 9.5 : 41);
  assert.equal(rows[0].duration, 9.5);
  assert.deepEqual(rows[0].engines.map(({ fits }) => fits), [true, true, true, true]);
  assert.equal(rows[1].duration, 41);
  assert.deepEqual(rows[1].engines.map(({ fits }) => fits), [false, false, false, true]);
  assert.deepEqual(rows[2], { itemId: 'audio-ref-gone', name: 'Gone take', available: false, duration: null, engines: [] });
  assert.deepEqual(await loadOwnedAudioComparison(null, items), []);
});

test('Listening Sets save bounded reusable comparison groups and prune stale references', () => {
  const local = storage();
  for (let index = 1; index <= 4; index += 1) {
    saveAudioReference(local, 'account-a', {
      jobId: `job-listening-audio-${index}`,
      name: `Listening ${index}`,
      purpose: 'timing-rhythm',
    }, `audio-ref-listening-${index}`);
  }
  let sets = saveAudioListeningSet(local, 'account-a', {
    name: '  Hero options  ',
    itemIds: ['audio-ref-listening-1', 'audio-ref-listening-2', 'audio-ref-listening-2', 'audio-ref-listening-3', 'audio-ref-listening-4'],
  }, 'listening-set-hero');
  assert.deepEqual(sets, [{
    id: 'listening-set-hero', name: 'Hero options',
    itemIds: ['audio-ref-listening-1', 'audio-ref-listening-2', 'audio-ref-listening-3'],
  }]);
  assert.deepEqual(saveAudioListeningSet(local, 'account-a', {
    name: 'hero OPTIONS', itemIds: ['audio-ref-listening-1', 'audio-ref-listening-2'],
  }, 'listening-set-duplicate'), sets);
  assert.deepEqual(saveAudioListeningSet(local, 'account-b', {
    name: 'Cross account', itemIds: ['audio-ref-listening-1', 'audio-ref-listening-2'],
  }, 'listening-set-cross'), []);
  removeAudioReference(local, 'account-a', 'audio-ref-listening-1');
  assert.deepEqual(readAudioListeningSets(local, 'account-a')[0].itemIds, ['audio-ref-listening-2', 'audio-ref-listening-3']);
  removeAudioReference(local, 'account-a', 'audio-ref-listening-2');
  assert.deepEqual(readAudioListeningSets(local, 'account-a'), []);
  assert.deepEqual(removeAudioListeningSet(local, 'account-a', 'bad/id'), []);
});

test('Audio Shelf Manifest exports metadata only and imports current-account owned audio', async () => {
  const local = storage();
  saveAudioReference(local, 'account-a', {
    jobId: 'job-existing-audio-123', name: 'Existing narrator', purpose: 'narration-presenter',
    traits: ['calm', 'authoritative', 'calm', 'invalid-trait'], voiceRecipe: DEFAULT_TTS_SETTINGS, url: 'https://secret.example/audio', script: 'private script',
  }, 'audio-ref-existing');
  toggleSignatureVoiceRecipe(local, 'account-a', 'audio-ref-existing');
  togglePinnedAudioReference(local, 'account-a', 'audio-ref-existing');
  const exported = createAudioShelfManifest(local, 'account-a', '2026-11-09T12:00:00.000Z');
  assert.deepEqual(exported, {
    schema: 'veyrnox-audio-shelf-manifest', version: 1, exportedAt: '2026-11-09T12:00:00.000Z',
    items: [{ jobId: 'job-existing-audio-123', name: 'Existing narrator', purpose: 'narration-presenter', traits: ['calm', 'authoritative'], voiceRecipe: DEFAULT_TTS_SETTINGS }],
    signatureJobIds: ['job-existing-audio-123'],
    pinnedJobIds: ['job-existing-audio-123'],
    listeningSets: [],
  });
  assert.doesNotMatch(JSON.stringify(exported), /secret\.example|private script|account-a|audio-ref-existing/);

  const manifest = {
    ...exported,
    items: [
      exported.items[0],
      { jobId: 'job-imported-audio-123', name: 'Imported character', purpose: 'character-performance', voiceRecipe: { ...DEFAULT_TTS_SETTINGS, emotion: 'happy' } },
      { jobId: 'job-unavailable-audio-123', name: 'Missing take', purpose: 'timing-rhythm' },
      { jobId: 'bad/id', name: 'Invalid', purpose: 'timing-rhythm' },
    ],
    signatureJobIds: ['job-imported-audio-123'],
    pinnedJobIds: ['job-imported-audio-123'],
    listeningSets: [{ name: 'Imported pair', jobIds: ['job-existing-audio-123', 'job-imported-audio-123'] }],
  };
  const calls = [];
  const result = await importOwnedAudioShelfManifest(async (path) => {
    calls.push(path);
    if (path.includes('job-unavailable-audio-123')) throw new Error('not owned');
    return path.endsWith('/asset') ? { url: 'https://assets.example/audio.wav', mime_type: 'audio/wav' } : { state: 'succeeded' };
  }, local, 'account-a', manifest, {
    idFactory: (index) => `audio-ref-import-${index + 1}`,
    setIdFactory: (index) => `listening-set-import-${index + 1}`,
  });
  assert.equal(result.imported, 1);
  assert.equal(result.existing, 1);
  assert.equal(result.unavailable, 1);
  assert.equal(result.rejected, 1);
  assert.equal(result.capacitySkipped, 0);
  assert.deepEqual(result.items.map((item) => item.jobId), ['job-imported-audio-123', 'job-existing-audio-123']);
  assert.deepEqual(result.signatures.length, 2);
  assert.deepEqual(result.pins.length, 2);
  assert.deepEqual(result.listeningSets, [{
    id: 'listening-set-import-1', name: 'Imported pair',
    itemIds: ['audio-ref-existing', 'audio-ref-import-2'],
  }]);
  assert.equal(calls.some((path) => path.includes('bad/id')), false);
  assert.equal(parseAudioShelfManifest({ schema: 'wrong', version: 1, items: [] }), null);
});

test('Audio Shelf Manifest import never evicts a full existing shelf', async () => {
  const local = storage();
  for (let index = 0; index < 24; index += 1) {
    saveAudioReference(local, 'account-a', {
      jobId: `job-capacity-audio-${String(index).padStart(3, '0')}`,
      name: `Existing ${index}`,
      purpose: 'timing-rhythm',
    }, `audio-ref-capacity-${index}`);
  }
  const before = readAudioReferenceShelf(local, 'account-a').map((item) => item.jobId);
  const result = await importOwnedAudioShelfManifest(async (path) => path.endsWith('/asset')
    ? { url: 'https://assets.example/new.wav', mime_type: 'audio/wav' }
    : { state: 'succeeded' }, local, 'account-a', {
    schema: 'veyrnox-audio-shelf-manifest', version: 1,
    items: [{ jobId: 'job-capacity-new-999', name: 'New item', purpose: 'timing-rhythm' }],
  });
  assert.equal(result.imported, 0);
  assert.equal(result.capacitySkipped, 1);
  assert.deepEqual(result.items.map((item) => item.jobId), before);
});

test('Shelf Health Check revalidates normalized references without returning signed links', async () => {
  const items = [
    { id: 'audio-ref-healthy', jobId: 'job-health-audio-123', name: 'Healthy', purpose: 'timing-rhythm' },
    { id: 'audio-ref-stale', jobId: 'job-stale-audio-123', name: 'Stale', purpose: 'lip-sync-dialogue' },
    { unsafe: true },
  ];
  const results = await auditOwnedAudioReferences(async (path) => {
    if (path.includes('job-stale-audio-123')) throw new Error('gone');
    return path.endsWith('/asset') ? { url: 'https://assets.example/health.wav', mime_type: 'audio/wav' } : { state: 'succeeded' };
  }, items);
  assert.deepEqual(results, [
    { itemId: 'audio-ref-healthy', jobId: 'job-health-audio-123', status: 'available' },
    { itemId: 'audio-ref-stale', jobId: 'job-stale-audio-123', status: 'unavailable' },
  ]);
  assert.doesNotMatch(JSON.stringify(results), /assets\.example/);
  assert.deepEqual(await auditOwnedAudioReferences(null, items), []);
});

test('reusing a shelf item rechecks succeeded ownership and an HTTPS audio asset', async () => {
  const calls = [];
  const result = await fetchOwnedAudioReference(async (path) => {
    calls.push(path);
    return path.endsWith('/asset')
      ? { url: 'https://assets.example/signed-audio', mime_type: 'audio/wav' }
      : { state: 'succeeded', label: 'Owned dialogue' };
  }, 'job-owned-audio-123');
  assert.deepEqual(calls, ['/jobs/job-owned-audio-123', '/jobs/job-owned-audio-123/asset']);
  assert.deepEqual(result, { id: 'job-owned-audio-123', url: 'https://assets.example/signed-audio', label: 'Owned dialogue' });

  let invalidCalls = 0;
  await assert.rejects(() => fetchOwnedAudioReference(async () => { invalidCalls += 1; }, 'bad/url'), /audio_reference_invalid/);
  assert.equal(invalidCalls, 0);
  await assert.rejects(() => fetchOwnedAudioReference(async () => ({ state: 'running' }), 'job-owned-audio-123'), /not_ready/);
  await assert.rejects(() => fetchOwnedAudioReference(async (path) => path.endsWith('/asset') ? { url: 'https://assets.example/video', mime_type: 'video/mp4' } : { state: 'succeeded' }, 'job-owned-audio-123'), /not_audio/);
  await assert.rejects(() => fetchOwnedAudioReference(async (path) => path.endsWith('/asset') ? { url: 'javascript:alert(1)', mime_type: 'audio/wav' } : { state: 'succeeded' }, 'job-owned-audio-123'), /url_invalid/);
});

test('Performance Studio exposes the personal shelf only on the owned-audio source path', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  const performance = readFileSync(new URL('../app/veyrnox/app/performance/PerformanceStudioClient.js', import.meta.url), 'utf8');
  assert.match(performance, /<AudioReferenceShelf audio=\{audio\}/);
  assert.match(performance, /onAudioReference=\{setAudioLibrary\}/);
  assert.match(component, /Audio Reference Shelf/);
  assert.match(component, /Library job ID, name, purpose and optional stock Voice Recipe/);
  assert.match(component, /never audio bytes, signed links, scripts, reusable consent, voiceprints or cloned identities/);
  assert.match(component, /fetchOwnedAudioReference\(gatewayFetch/);
});

test('Audio Reference Shelf can reopen a validated recipe without carrying its script', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /Reuse Voice Recipe/);
  assert.match(component, /stageVoiceRecipeHandoff\(window\.sessionStorage, accountId/);
  assert.match(component, /router\.push\('\/app\/text-to-speech'\)/);
});

test('Audio Reference Shelf exposes searchable production-purpose filters', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /Audio Shelf Finder/);
  assert.match(component, /aria-label="Search Audio Shelf"/);
  assert.match(component, /Filter Audio Shelf by purpose/);
  assert.match(component, /Filter Audio Shelf by health/);
  assert.match(component, /All health states/);
  assert.match(component, /Needs review/);
  assert.match(component, /Not checked/);
  assert.match(component, /Voice Recipes only/);
  assert.match(component, /Showing \{visibleItems\.length\} of \{items\.length\} saved references/);
  assert.match(component, /No saved references match these Shelf Finder filters/);
});

test('Audio Reference Shelf compares up to three freshly revalidated owned performances', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /Reference Listening Board/);
  assert.match(component, /loadOwnedAudioComparison\(gatewayFetch, selected\)/);
  assert.match(component, /Fresh links and durations stay in memory only/);
  assert.match(component, /does not identify speakers, score similarity, clone voices or generate media/);
  assert.match(component, /aria-label="Fresh owned audio comparison"/);
  assert.match(component, /Remove compare/);
  assert.match(component, /Use for this performance/);
  assert.match(component, /Selected for performance/);
  assert.match(component, /item&&activateReference\(item\)/);
  assert.match(component, /audio\?\.jobId===item\.jobId/);
  assert.match(component, /Checking duration…/);
});

test('Audio Reference Shelf exports and ownership-revalidates portable metadata manifests', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /revalidate audio jobs against the current account/);
});

test('Audio Reference Shelf health audit labels stale items without deleting them', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /Check shelf health/);
  assert.match(component, /auditOwnedAudioReferences\(gatewayFetch, items\)/);
  assert.match(component, /Available/);
  assert.match(component, /Needs review/);
  assert.match(component, /Nothing was removed/);
  assert.match(component, /without generating or deleting media/);
});

test('Audio Reference Shelf exposes inline local metadata curation', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /Edit label/);
  assert.match(component, /Edit audio reference name/);
  assert.match(component, /Edit audio reference purpose/);
  assert.match(component, /Save label/);
  assert.match(component, /The Library asset, audio and Voice Recipe were not changed/);
  assert.match(component, /updateAudioReferenceMetadata\(window\.localStorage, accountId/);
});

test('Audio Reference Shelf exposes non-persistent Shelf Views sorting', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /aria-label="Sort Audio Shelf"/);
  assert.match(component, /Recently saved/);
  assert.match(component, /Name A–Z/);
  assert.match(component, /Production purpose/);
  assert.match(component, /Review priority/);
  assert.match(component, /sortAudioReferences\(/);
});

test('Audio Reference Shelf exposes portable Cue Pins for any saved audio', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /Cue Pins only/);
  assert.match(component, /Pin cue/);
  assert.match(component, /Unpin cue/);
  assert.match(component, /MAX_PINNED_AUDIO_REFERENCES/);
  assert.match(component, /togglePinnedAudioReference\(window\.localStorage, accountId/);
});

test('Audio Reference Shelf exposes human-selected bounded Cue Tags', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /Filter Audio Shelf by Cue Tag/);
  assert.match(component, /All Cue Tags/);
  assert.match(component, /Cue Tags · choose up to/);
  assert.match(component, /data\.getAll\('traits'\)/);
  assert.match(component, /aria-label="Cue Tags"/);
});

test('Audio Reference Shelf saves and reopens named Listening Sets without loading media', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /Listening Sets/);
  assert.match(component, /Save current board/);
  assert.match(component, /Open in board/);
  assert.match(component, /Audio remains unloaded until you request a fresh check/);
  assert.match(component, /saveAudioListeningSet\(window\.localStorage, accountId/);
  assert.match(component, /removeAudioListeningSet\(window\.localStorage,accountId/);
});

test('Reference Listening Board displays memory-only duration and engine-fit cards', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /loadOwnedAudioComparison\(gatewayFetch, selected\)/);
  assert.match(component, /Comparison timing fit/);
  assert.match(component, /live engine fit/);
  assert.match(component, /Timing unavailable · server limit still applies/);
  assert.match(component, /Fresh links and durations stay in memory only/);
});

test('Audio Shelf engine fit follows the four current live duration contracts', () => {
  const ten = audioEngineFit(10);
  assert.deepEqual(ten.map(({ id, maxSeconds, fits }) => [id, maxSeconds, fits]), [
    ['kling-avatar-v2', 10, true],
    ['sync-lipsync-v3', 10, true],
    ['latentsync', 40, true],
    ['sync-lipsync-1.9-long', 180, true],
  ]);
  assert.deepEqual(audioEngineFit(10.01).map(({ fits }) => fits), [false, false, true, true]);
  assert.deepEqual(audioEngineFit(40).map(({ fits }) => fits), [false, false, true, true]);
  assert.deepEqual(audioEngineFit(180).map(({ fits }) => fits), [false, false, false, true]);
  assert.deepEqual(audioEngineFit(41).map(({ overBy }) => overBy), [31, 31, 1, 0]);
  assert.deepEqual(audioEngineFit(10.04).map(({ overBy }) => overBy), [0, 0, 0, 0]);
  assert.deepEqual(audioEngineFit(10.06).map(({ overBy }) => overBy), [0.1, 0.1, 0, 0]);
  assert.deepEqual(audioEngineFit(Number.NaN), []);
  assert.deepEqual(audioEngineFit(-1), []);
});

test('audio duration reads metadata from a disposable HTTPS audio element', async () => {
  let removed = false;
  let reloaded = false;
  const fake = {
    duration: 0,
    removeAttribute: (name) => { if (name === 'src') removed = true; },
    load: () => { reloaded = true; },
    set src(value) {
      assert.equal(value, 'https://assets.example/owned.wav');
      queueMicrotask(() => { this.duration = 24.6; this.onloadedmetadata(); });
    },
  };
  assert.equal(await readAudioDuration('https://assets.example/owned.wav', { audioFactory: () => fake }), 24.6);
  assert.equal(fake.preload, 'metadata');
  assert.equal(removed, true);
  assert.equal(reloaded, true);
  await assert.rejects(() => readAudioDuration('javascript:alert(1)', { audioFactory: () => fake }), /audio_duration_invalid/);
});

test('Audio Reference Shelf shows memory-only engine fit after an owned asset check', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/AudioReferenceShelf.js', import.meta.url), 'utf8');
  assert.match(component, /readAudioDuration\(owned\.url\)/);
  assert.match(component, /audioEngineFit\(duration\)/);
  assert.match(component, /Audio engine fit/);
  assert.match(component, /Length unknown · server check still required/);
  assert.match(component, /Shorten \$\{durationLabel\(engine\.overBy\)\}/);
});
