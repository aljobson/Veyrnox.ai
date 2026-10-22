import test from 'node:test';
import assert from 'node:assert/strict';
import { stageChatStudioDraft } from '../app/veyrnox/_lib/chatStudioDraft.js';
import { LANDING_DRAFT_KEY, takeStudioDraft } from '../app/veyrnox/_lib/landingDraft.js';
import { parseStudioDrafts } from '../app/veyrnox/_lib/studioSkills.js';
import { fromFallback } from '../app/veyrnox/_lib/useCatalog.js';

const NOW = 5_000_000;
const draft = { model: 'video-model', kind: 'video', prompt: 'locked Oddling walking through rain', aspect: '9:16', needs: ['image'] };
const oddling = { picks: { oddling_name: 'Mossbyte', body_type: 'Full-bodied' }, portraitId: 'portrait-a', motionId: 'motion-a' };

test('a Chat Studio draft stages its prompt and passport before Create can open', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const destination = stageChatStudioDraft(storage, draft, oddling, NOW);
  assert.equal(destination, '/app/create?model=video-model&oddling=1&passport=1&oddlingPhoto=portrait-a&motion=motion-a');
  assert.deepEqual(takeStudioDraft(storage, 'video-model', NOW + 1), {
    prompt: draft.prompt, aspect: '9:16', oddlingPicks: oddling.picks,
  });
});

test('a Kling draft drops an unsupported 9:16 promise through the complete Create handoff', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const catalog = [{ id: 'kling-3.0-i2v', name: 'Kling 3.0', kind: 'video', credits: 34, gated: false, media: { image: { required: true } } }];
  const [parsed] = parseStudioDrafts('```studio\n{"model":"kling-3.0-i2v","prompt":"Mossbyte waves","aspect":"9:16"}\n```', catalog);
  assert.equal(parsed.aspect, null);
  assert.match(stageChatStudioDraft(storage, parsed, oddling, NOW), /model=kling-3\.0-i2v/);
  assert.equal(takeStudioDraft(storage, 'kling-3.0-i2v', NOW + 1).aspect, null);
});

test('a failed overwrite never navigates to Create or exposes a stale same-model draft', () => {
  const old = JSON.stringify({ prompt: 'old unrelated prompt', model: 'video-model', aspect: '16:9', at: NOW - 1 });
  const storage = {
    getItem: (key) => key === LANDING_DRAFT_KEY ? old : null,
    setItem() { throw new Error('storage blocked'); },
    removeItem() {},
  };
  assert.equal(stageChatStudioDraft(storage, draft, oddling, NOW), null);
  assert.equal(storage.getItem(LANDING_DRAFT_KEY), old, 'the caller must stay in Chat rather than opening this stale value');
});

test('an edited passport with no verified portrait opens without a stale source image', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const destination = stageChatStudioDraft(storage, draft, { ...oddling, portraitId: '' }, NOW);
  assert.equal(destination, '/app/create?model=video-model&oddling=1&passport=1');
  assert.doesNotMatch(destination, /oddlingPhoto|motion=/);
});

test('an image edit keeps the passport but never uses the animation-only portrait handoff', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const destination = stageChatStudioDraft(storage, { ...draft, model: 'image-edit', kind: 'image' }, oddling, NOW);
  assert.equal(destination, '/app/create?model=image-edit&oddling=1&passport=1');
  assert.doesNotMatch(destination, /oddlingPhoto|motion=/);
});

test('catalog outage fallback keeps the required Kling start image and Oddling portrait', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const catalog = fromFallback();
  const kling = catalog.find((model) => model.id === 'kling-3.0-i2v');
  assert.deepEqual(kling.media.image, { required: true, kind: 'image', label: 'Start frame' });
  assert.equal(kling.aspects, null, 'the fallback does not invent an unsupported ratio');
  const [parsed] = parseStudioDrafts('```studio\n{"model":"kling-3.0-i2v","prompt":"Mossbyte waves"}\n```', catalog);
  assert.deepEqual(parsed.needs, ['image']);
  assert.match(stageChatStudioDraft(storage, parsed, oddling, NOW), /oddlingPhoto=portrait-a/);
});
