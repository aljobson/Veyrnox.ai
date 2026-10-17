import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CREATE_DRAFT_STORAGE, readCreateDraft, writeCreateDraft, reopenDraftSources, readVeyWorkspace, writeVeyWorkspace } from '../lib/createDraftRecovery.js';
const now = 1700000000000;
const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
const draft = { modelId: 'kling-3.0-i2v', goal: 'video', duration: '5s', aspect: '16:9', prompt: 'Animate Max Rep with a small wave.', sources: { image: { assetId: 'saved-max-rep', label: 'Max Rep', previewUrl: 'https://private.invalid/old-signed-url' } }, consent: true, cost: 34, balance: 76, access_token: 'not-stored' };
test('reload retains the selected model, prompt, duration and exact Library identity, not ephemeral URLs or consent', () => {
  const s = storage();
  assert.equal(writeCreateDraft(s, 'alice', draft, now), true);
  const saved = readCreateDraft(s, 'alice', now + 1);
  assert.equal(saved.modelId, draft.modelId); assert.equal(saved.duration, '5s'); assert.equal(saved.prompt, draft.prompt);
  assert.deepEqual(saved.sources.image, { assetId: 'saved-max-rep', label: 'Max Rep' });
  const raw = s.getItem(`${CREATE_DRAFT_STORAGE}:alice`);
  for (const excluded of ['old-signed-url', 'consent', 'cost', 'balance', 'access_token']) assert.ok(!raw.includes(excluded));
});
test('drafts are account-scoped, tab-storage compatible, expire after 24 hours, and tolerate blocked storage', () => {
  const s = storage(); writeCreateDraft(s, 'alice', draft, now);
  assert.equal(readCreateDraft(s, 'bob', now), null);
  assert.equal(readCreateDraft(s, 'alice', now + 86400001), null);
  assert.equal(readCreateDraft(s, 'alice', now - 120000), null);
  assert.equal(readCreateDraft({ getItem() { throw Error(); } }, 'alice', now), null);
  assert.equal(writeCreateDraft({ setItem() { throw Error(); } }, 'alice', draft, now), false);
  s.setItem(`${CREATE_DRAFT_STORAGE}:alice`, '{bad'); assert.equal(readCreateDraft(s, 'alice', now), null);
});
test('recovery requests fresh owned asset links using IDs only and never generates or substitutes another source', async () => {
  const s = storage(); writeCreateDraft(s, 'alice', draft, now);
  const calls = [];
  const { restored, failed } = await reopenDraftSources(readCreateDraft(s, 'alice', now).sources, async path => {
    calls.push(path); return { url: 'https://media.invalid/new-link', mime_type: 'image/jpeg' };
  });
  assert.deepEqual(calls, ['/jobs/saved-max-rep/asset']);
  assert.equal(restored.image.assetId, 'saved-max-rep'); assert.equal(restored.image.previewUrl, 'https://media.invalid/new-link'); assert.deepEqual(failed, []);
  const denied = await reopenDraftSources(draft.sources, async () => { throw Error('forbidden'); });
  assert.deepEqual(denied.restored, {}); assert.deepEqual(denied.failed, ['image']);
  const wrongType = await reopenDraftSources(draft.sources, async () => ({ url: 'https://media.invalid/video', mime_type: 'video/mp4' }));
  assert.deepEqual(wrongType.failed, ['image']);
});
test('local upload bytes are not serialized and the restored draft marks them for reattachment', () => {
  const s = storage(); writeCreateDraft(s, 'alice', { ...draft, sources: { image: { file: { name: 'private.png' }, previewUrl: 'blob:private-data' } } }, now);
  const saved = readCreateDraft(s, 'alice', now); assert.equal(saved.needsUpload, true); assert.deepEqual(saved.sources, {});
  assert.ok(!s.getItem(`${CREATE_DRAFT_STORAGE}:alice`).includes('private'));
});
test('helper visibility and the simultaneous question/walkthrough mode survive reload without persisting messages', () => {
  const s = storage(); writeVeyWorkspace(s, 'alice', { open: true, chatting: true, messages: ['private text'] }, now);
  assert.deepEqual(readVeyWorkspace(s, 'alice', now), { open: true, chatting: true });
  assert.deepEqual(readVeyWorkspace(s, 'bob', now), { open: false, chatting: false });
  assert.deepEqual(readVeyWorkspace(s, 'alice', now + 86400001), { open: false, chatting: false });
});
test('restoration guards submission and catalog normalization, resets rights, and never calls onSubmit', () => {
  const page = readFileSync(new URL('../app/veyrnox/app/create/page.js', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../app/veyrnox/_lib/useCreateDraftRecovery.js', import.meta.url), 'utf8');
  assert.match(page, /if \(draftRecovery.restoring \|\| draftRecovery.blocked\) return;/);
  assert.match(page, /disabled=\{draftRecovery.restoring \|\| draftRecovery.blocked/);
  assert.match(page, /setSources\(restoredSources\); setConsent\(false\)/);
  assert.match(page, /draftRecovery.restoring \|\| catalogLoading/);
  assert.match(page, /inert=\{draftRecovery.restoring\}/);
  assert.match(hook, /actorSnapshot\(\) !== actor/);
  assert.doesNotMatch(hook, /onSubmit|\/generations|method: 'POST'/);
});
