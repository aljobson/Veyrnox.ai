import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FACELESS_REEL_PROMPT_MAX,
  facelessBriefLength,
  facelessBriefRoom,
  FACELESS_REEL_FORMATS,
  FACELESS_REEL_PACING,
  FACELESS_REEL_PLATFORMS,
  buildFacelessReelPrompt,
  facelessReelLaunch,
  facelessReelValidation,
} from '../app/veyrnox/_lib/facelessReel.js';

import { capabilityFor } from '../lib/modelCapabilities.js';
import messages from '../lib/i18n/messages/app/en/faceless-reel.mjs';
import { translator } from '../lib/i18n/translate.mjs';

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
  assert.match(prompt, /Do not render it as text/);
  assert.match(prompt, /9:16/);
  assert.match(prompt, /No identifiable face/);
  assert.match(prompt, /Silent visual master/);
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


test('the prompt cap matches Wan and every supported combination leaves room for a brief', () => {
  assert.equal(FACELESS_REEL_PROMPT_MAX, capabilityFor('market:wan/2-5-text-to-video').inputs.prompt.max);
  for (const { id: format } of FACELESS_REEL_FORMATS)
    for (const { id: pacing } of FACELESS_REEL_PACING)
      for (const { id: platform } of FACELESS_REEL_PLATFORMS)
        for (const duration of [5, 10]) {
          const values = { ...READY, format, pacing, platform, duration, hook: 'h'.repeat(160), topic: 't'.repeat(20) };
          assert.ok(buildFacelessReelPrompt(values).length <= 800, JSON.stringify(values));
        }
  assert.ok(facelessBriefRoom({ ...READY, hook: '' }) >= 200);
});

test('READY matches the fixed phone prompt exactly', () => {
  assert.equal(buildFacelessReelPrompt(READY), 'Original 5-second faceless short-form video about: Show how a seed becomes a thriving balcony herb garden through clear object-led visual beats. Hook for later captions: A tiny habit with a visible payoff. Do not render it as text. Structure: Visual explainer. Clear setup, reveal and resolved final frame. Pacing: Balanced. Clear hook, purposeful middle, stable finish. Delivery: Reels / TikTok, 9:16; keep action mobile-safe and the lower third clear. No identifiable face, presenter, celebrity likeness, copied creator style, private information, platform interface, logos or watermarks. Stable continuity, lighting and motif; no generated text, subtitles or unsupported claims. Silent visual master.');
  assert.match(buildFacelessReelPrompt({ ...READY, pacing: 'unknown' }), /Pacing: Measured\. Calm motion; hold the readable final frame\./);
});

test('prompt overflow is translated and never truncates the topic or hook', () => {
  const values = { ...READY, topic: 'x'.repeat(790), hook: 'h'.repeat(160) };
  assert.equal(facelessReelValidation(values, translator('en', messages)), 'Shorten the brief or hook: this model accepts 800 characters in all.');
  assert.ok(buildFacelessReelPrompt(values).includes(values.topic));
  assert.ok(buildFacelessReelPrompt(values).includes(values.hook));
  assert.equal(facelessBriefLength({ topic: '  A brief.!?  ' }), 7);
  assert.equal(facelessBriefRoom(READY, 900), 900 - buildFacelessReelPrompt({ ...READY, topic: '' }).length);
  const room = facelessBriefRoom(READY);
  assert.equal(facelessReelValidation({ ...READY, topic: 'x'.repeat(room) }), null);
  assert.match(facelessReelValidation({ ...READY, topic: 'x'.repeat(room + 1) }), /800/);
  assert.match(facelessReelValidation({ ...READY, topic: 'x'.repeat(801) }), /visual brief/);
  assert.match(facelessReelValidation({ ...READY, hook: 'h'.repeat(161) }), /optional hook/);
});

test('the studio shows the available prompt budget and blocks overlong launches', () => {
  const source = readFileSync(new URL('../app/veyrnox/_components/FacelessReelStudio.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\/800<|topic\.length}\/800/);
  for (const key of ['app.facelessReel.counter', 'app.facelessReel.over', 'app.facelessReel.error.promptLong', 'facelessBriefRoom']) assert.ok(source.includes(key));
  assert.match(source, /aria-live="polite"/);
  assert.match(source, /disabled=\{promptLong\}/);
  assert.match(source, /maxLength=\{800\}/);
});
