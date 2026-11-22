import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  appendSunoStyle, capSunoText, isSunoContract, sunoCustomQuoteRequest, sunoCustomReady,
  preserveSunoDraftText, sunoControlsForModel, sunoDuration, sunoFormatEditsUnavailable,
  sunoLimit, sunoSimpleQuoteRequest,
} from '../app/veyrnox/_components/music/musicSunoForm.js';

const model = {
  id: 'ace-step-1.5', provider_contract: 'crun-suno-v1', available: true,
  generation_modes: ['simple', 'custom'],
  controls: { duration_seconds: { min: 1, max: 135, default: 60 } },
  counters: { prompt: { max: 417 }, title: { max: 79 }, lyrics: { max: 4999 }, styles: { max: 997 }, exclude_styles: { max: 991, applied: 199 } },
};

test('Suno UI limits and duration come only from the entitlement projection', () => {
  assert.equal(isSunoContract(model), true);
  assert.equal(sunoLimit(model, 'prompt'), 417);
  assert.equal(sunoLimit(model, 'lyrics'), 4999);
  assert.equal(sunoDuration(model, null), 60);
  assert.equal(sunoDuration(model, 999), 135);
  assert.equal(sunoDuration({ ...model, controls: {} }, 60), null);
});

test('simple and custom quote wires carry contract and immutable draft identity', () => {
  assert.deepEqual(sunoSimpleQuoteRequest({ model, prompt: '  harbour pop  ', instrumental: true }), {
    mode: 'simple', provider_contract: 'crun-suno-v1', model_id: 'ace-step-1.5',
    prompt: 'harbour pop', instrumental: true, suno_model: 'v6',
  });
  const draft = { id: '92ed2d0d-8276-4fbb-9c4f-39f401a3158b', revision: 9, title: 'Harbour', lyrics: 'Line', styles: 'Indie' };
  const request = sunoCustomQuoteRequest({ model, draft, controls: {
    instrumental: false, rightsConfirmed: true, durationSeconds: 88, sunoModel: 'v6_wild',
    vocalGender: 'female', styleWeight: 0.65, weirdness: 0.25, variety: 4, excludeStyles: ' noise ',
  } });
  assert.equal(request.provider_contract, 'crun-suno-v1');
  assert.equal(request.draft_id, draft.id);
  assert.equal(request.draft_revision, 9);
  assert.equal(request.style_influence, 65);
  assert.equal(request.variety, 100);
  assert.equal(request.exclude_styles, 'noise');
  assert.equal(sunoCustomReady({ model, draft, controls: { instrumental: false, rightsConfirmed: true } }), true);
  assert.equal(sunoCustomReady({ model, draft: { ...draft, lyrics: '' }, controls: { instrumental: false, rightsConfirmed: true } }), false);
});

test('style picker de-duplicates values and respects the projected cap', () => {
  assert.equal(appendSunoStyle('Jazz', 'jazz', 50), 'Jazz');
  assert.equal(appendSunoStyle('Jazz', 'Electronic', 15), 'Jazz, Electroni');
  assert.equal(capSunoText('🎵'.repeat(6), 5), '🎵'.repeat(5));
});

test('instrumental-only offers, stale drafts and format explanations preserve their invariants', () => {
  const controls = { instrumental: false, variety: 1 };
  assert.deepEqual(sunoControlsForModel({ instrumental_only: true }, controls), { instrumental: true, variety: 1 });
  assert.equal(sunoControlsForModel({}, controls), controls);
  assert.deepEqual(preserveSunoDraftText(
    { id: 'new', provider_contract: 'crun-suno-v1', revision: 1, lyrics: '', styles: '', title: '' },
    { lyrics: 'local lyrics', styles: 'local style', title: 'local title' },
  ), { id: 'new', provider_contract: 'crun-suno-v1', revision: 1, lyrics: 'local lyrics', styles: 'local style', title: 'local title' });
  assert.equal(sunoFormatEditsUnavailable({ playback: true, render: false, crop: false }), true);
  assert.equal(sunoFormatEditsUnavailable({ playback: true, render: true, crop: true, stems: false }), false);
  assert.equal(sunoFormatEditsUnavailable({ render: false, crop: false }), false, 'legacy rows do not get a misleading note');
});

test('Chat switches only the Crun audio contract to Music pair submission', async () => {
  const workspace = await readFile(new URL('../app/veyrnox/_components/chat/ChatWorkspace.js', import.meta.url), 'utf8');
  const hook = await readFile(new URL('../app/veyrnox/_components/chat/useChatMusicGeneration.js', import.meta.url), 'utf8');
  const generic = await readFile(new URL('../app/veyrnox/_components/chat/useChatMediaGeneration.js', import.meta.url), 'utf8');
  const state = await readFile(new URL('../app/veyrnox/_components/music/useMusicServerState.js', import.meta.url), 'utf8');
  assert.match(workspace, /!musicGeneration\.resolved \|\| musicGeneration\.suno/);
  assert.doesNotMatch(workspace, /musicGeneration\.suno \|\| musicGeneration\.error/);
  assert.match(hook, /filter\(isSunoContract\)/);
  assert.match(hook, /sunoControlsForModel\(model, controls\)/);
  assert.match(hook, /instrumental: effectiveControls\.instrumental/);
  assert.match(state, /'\/music\/generation-quotes'/);
  assert.match(state, /'\/music\/generations'/);
  assert.match(generic, /gatewayFetch\('\/generations'/, 'fal and non-Music audio keep the existing path');
  assert.match(hook, /persisted|thread/i, 'document the no-thread-message behavior');
  assert.match(hook, /resolved: entitlements !== null \|\| Boolean\(server\.error\)/);
  const composer = await readFile(new URL('../app/veyrnox/_components/chat/MediaComposer.js', import.meta.url), 'utf8');
  assert.match(composer, /customMode && controlsOpen \? <div/);
  assert.doesNotMatch(composer, /absolute bottom-14/, 'required custom controls are not clipped inside the scrolling row');
});

test('draft saves and pair confirmation carry contract identity and refresh stale state', async () => {
  const draft = await readFile(new URL('../app/veyrnox/_components/music/useMusicCustomDraft.js', import.meta.url), 'utf8');
  const state = await readFile(new URL('../app/veyrnox/_components/music/useMusicServerState.js', import.meta.url), 'utf8');
  assert.match(draft, /provider_contract: draft\.provider_contract/);
  assert.match(draft, /draft_id: draft\.id/);
  assert.match(draft, /reason\?\.code === 'contract_stale'/);
  assert.match(draft, /preserveSunoDraftText\(server, local\)/);
  assert.match(draft, /await onContractStale\?\.\(\)/);
  assert.match(state, /provider_contract: quote\.provider_contract/);
  assert.match(state, /REQUOTE_ERRORS[\s\S]*contract_stale/);
  assert.match(state, /await loadEntitlements\(\)/);
  assert.match(draft, /needsReview/);
  const reuse = await readFile(new URL('../app/veyrnox/_components/music/MusicReuseDialog.jsx', import.meta.url), 'utf8');
  assert.match(reuse, /provider_contract: context\.provider_contract/);
  assert.match(reuse, /draft_id: context\.draft_id/);
  assert.match(reuse, /reason\?\.code === 'contract_stale'/);
  const studio = await readFile(new URL('../app/veyrnox/_components/music/MusicServerStudio.jsx', import.meta.url), 'utf8');
  assert.match(studio, /provider_contract: selectedModel\?\.provider_contract/);
  assert.match(studio, /draft_id: saved\.id/);
  assert.match(studio, /provider_contract: model\.provider_contract/);
});

test('song actions consume reader capabilities and explain hidden format edits', async () => {
  const detail = await readFile(new URL('../app/veyrnox/_components/music/MusicServerSongDetail.jsx', import.meta.url), 'utf8');
  const actions = await readFile(new URL('../app/veyrnox/_components/music/MusicSongActions.jsx', import.meta.url), 'utf8');
  assert.match(detail, /capabilities=\{song\.current_version\?\.capabilities\}/);
  assert.match(actions, /sunoFormatEditsUnavailable\(capabilities\)/);
  assert.match(actions, /app\.music\.suno\.editUnavailable/);
});
