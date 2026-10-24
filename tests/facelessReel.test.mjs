import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FACELESS_REEL_FORMATS,
  FACELESS_REEL_PACING,
  FACELESS_REEL_PLATFORMS,
  buildFacelessReelPrompt,
  facelessReelLaunch,
  facelessReelValidation,
} from '../app/veyrnox/_lib/facelessReel.js';

const READY = {
  topic: 'Show how a seed becomes a thriving balcony herb garden through clear object-led visual beats.',
  hook: 'A tiny habit with a visible payoff',
  format: 'explainer', pacing: 'balanced', platform: 'reels', duration: 5,
  originality: true, faceless: true,
};

test('faceless reel offers bounded original structures, pacing and delivery frames', () => {
  assert.equal(FACELESS_REEL_FORMATS.length, 4);
  assert.equal(FACELESS_REEL_PACING.length, 3);
  assert.deepEqual(FACELESS_REEL_PLATFORMS.map(({ id, aspect }) => [id, aspect]), [['reels', '9:16'], ['shorts', '9:16'], ['web', '16:9']]);
});

test('the visual prompt preserves the plan without pretending to render finishing layers', () => {
  const prompt = buildFacelessReelPrompt(READY);
  assert.match(prompt, /original 5-second faceless short-form video/i);
  assert.match(prompt, /Do not render the words/i);
  assert.match(prompt, /9:16/);
  assert.match(prompt, /Do not show an identifiable face/i);
  assert.match(prompt, /Narration, music, sound design, captions and publishing are separate/i);
});

test('launch carries only supported settings and the explicit sound continuation', () => {
  assert.deepEqual(facelessReelLaunch({ ...READY, sound: true }), {
    model: 'wan-2.5-kie', prompt: buildFacelessReelPrompt({ ...READY, sound: true }),
    aspect: '9:16', durationSeconds: 5, followup: 'generated-sound',
  });
  assert.deepEqual(facelessReelLaunch({ ...READY, platform: 'web', duration: 10 }), {
    model: 'wan-2.5-kie', prompt: buildFacelessReelPrompt({ ...READY, platform: 'web', duration: 10 }),
    aspect: '16:9', durationSeconds: 10,
  });
});

test('the planner refuses thin briefs, unsupported lengths and a long sound pass', () => {
  assert.match(facelessReelValidation({ ...READY, topic: 'Too short' }), /at least 20/i);
  assert.match(facelessReelValidation({ ...READY, duration: 7 }), /5- or 10-second/i);
  assert.match(facelessReelValidation({ ...READY, duration: 10, sound: true }), /only for the 5-second reel/i);
  assert.match(facelessReelValidation({ ...READY, faceless: false }), /faceless-media review/i);
  assert.equal(facelessReelValidation(READY), null);
});

test('the dedicated page exposes the non-spending provider boundary', () => {
  const component = readFileSync(new URL('../app/veyrnox/_components/FacelessReelStudio.js', import.meta.url), 'utf8');
  assert.match(component, /app\.facelessReel\.title/);
  assert.match(component, /app\.facelessReel\.soundTitle/);
  assert.match(component, /app\.facelessReel\.soundHelp/);
  assert.match(component, /writeStudioDraft\(window\.sessionStorage/);
  assert.match(component, /model=wan-2\.5-kie&recipe=faceless-reel/);
  assert.match(component, /app\.facelessReel\.transfer\.separate/);
});
