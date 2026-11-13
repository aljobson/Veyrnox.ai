import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../app/veyrnox/_lib/templates.js';
import { templateVideoDependency, templateVideoEvidence } from '../lib/templateVideoDependency.js';
import { templateAudioDependency, templateAudioEvidence } from '../lib/templateAudioDependency.js';
const source = id => { const p = PRESETS.find(p => p.id === id); assert.ok(p, id); return p.sourcePrompt; };
// Hand-reviewed strata: substitutions, preserved choreography/environment,
// named uploaded clips, unnumbered tokens, video authority, same-motion clauses.
const positives = [
  'community-driver-portrait', 'k9-dance-groove', 'twilight-field-memory',
  'identity-locked-performance', 'community-noir-leading-role', 'community-portrait-performance-recast',
  'community-supercar-getaway', 'community-canine-recording-session', 'community-stone-arcade-pose',
  'community-balcony-club-encounter', 'community-street-dance-trio', 'community-lounge-group-performance',
  'community-car-selfie-performance', 'community-feline-dance-duo', 'community-liquid-truck-assembly',
  'community-marble-hallway-pose', 'community-urban-street-pose', 'community-parking-lot-recast',
  'community-showroom-car-reveal', 'community-urban-fashion-stroll', 'community-urban-suit-swap',
  'community-evening-party-recast', 'community-festival-stage-swap', 'community-elevator-mirror-selfie',
  'community-pink-studio-recast', 'community-retro-seoul-strut', 'community-sidewalk-groove-duo',
  'community-manor-bridge-blast', 'community-suit-walk', 'community-vehicle-swap-drift',
  'community-shopping-bag-unpack', 'community-studio-product-showcase', 'community-smoke-show-spotlight',
  'community-broomstick-flight-swap', 'community-night-range-swap', 'community-suit-duo-dance',
  'community-ceiling-fan-transition', 'community-skyline-supercar-drive', 'community-pampered-spa-feline',
  'community-style-swap-rhythm', 'community-flying-cake-ride', 'community-automotive-symbiote-forge',
  'community-garden-path-tea', 'community-synchronized-group-formation', 'community-electrician-character-swap',
  'community-symbiote-supercar-shift', 'community-suit-synchronized-dance', 'community-street-dance-ensemble',
  'community-street-corner-dance', 'community-luxury-sedan-swap',
];
const negatives = [
  'jellyfish-airlines', 'sm-brand-new-day', 'the-wrong-one', 'hotel-window-watch',
  'escalator-loop', 'fashion-catch', 'red-thread-story', 'meal-together', 'natural-viral-makeover',
  'studio-ballerina-turns', 'little-storm-knight', 'community-suit-crowd-shift', 'community-bipedal-cat-sprint',
];
for (const id of positives) test(`reviewed external video: ${id}`, () => {
  const text = source(id);
  assert.equal(templateVideoDependency(text), true);
  for (const e of templateVideoEvidence(text)) assert.equal(text.slice(e.offset, e.offset + e.phrase.length), e.phrase);
});
for (const id of negatives) test(`reviewed generation directions, no external video/audio: ${id}`, () => {
  assert.equal(templateVideoDependency(source(id)), false);
  assert.equal(templateAudioDependency(source(id)), false);
});
for (const [text, video, audio] of [
  ['Use the uploaded image to create a video. Preserve the original pose.', false, false],
  ['Generate original camera movement and choreography. Preserve the original identity.', false, false],
  ['Preserve the original environment and camera movement.', false, false],
  ['Create an original video with original music.', false, false],
  ['Generate original audio.', false, false],
  ['No source video. No source audio. Dialogue: None. No music.', false, false],
  ['Do not use the reference video. Do not use original audio.', false, false],
  ['Do not modify the source video or original audio.', true, true],
  ['Use the motion from the reference video.', true, false],
  ['Keep the original video’s environment.', true, false],
  ['@video1 <<<video_2>>> video_3.mp4', true, false],
  ['Preserve the original audio unchanged.', false, true],
  ['Use @audio1.', false, true],
  ['Do not infer or generate any audio from @video1.', true, false],
  ['Keep the original timing and audio.', false, true],
  ['Generate dialogue: Hello there. Keep the soundtrack clean and consistent.', false, false],
]) test(`precision phrase: ${text}`, () => {
  assert.equal(templateVideoDependency(text), video);
  assert.equal(templateAudioDependency(text), audio);
});
for (const id of ['fat-parkour', 'urban-broomstick-flight', 'identity-locked-performance', 'unforgettable', 'freestyle', 'the-lost-chase', 'burning-bridges', 'wheelie-rider', 'playing-chess-with-tesla', 'fly-over-the-teslas', 'community-parking-lot-recast', 'community-fairy-tale-walk', 'community-nightclub-duo-recast', 'community-boutique-hoodie-reveal', 'community-elevator-entrance-interaction', 'community-brand-billboard-swap', 'seedance-burning-stage', 'seedance-rooftop-shepherd', 'seedance-hotel-lobby', 'live-stage-performance']) test(`reviewed preserved external audio: ${id}`, () => {
  const text = source(id);
  assert.equal(templateAudioDependency(text), true);
  for (const e of templateAudioEvidence(text)) assert.equal(text.slice(e.offset, e.offset + e.phrase.length), e.phrase);
});
for (const id of ['epic-train-doorway-scene', 'a-moment-between-strangers', 'trick-or-skin', 'curtain-reveal', 'sheep-kingdom', 'tentacle-breakout', 'community-candle-wish-drift', 'community-rotating-wardrobe-wipe', 'pizzeria-hide-and-seek', 'coliseum-drift', 'theater-ceiling-horror', 'wear-the-moment', 'reflection-in-the-mirror', 'car-blows-up', 'pumpkin-guardian', 'ghost-makeover', 'one-last-embrace', 'birthday-drift', 'office-escape', 'rap-takeover', 'event-character-swap', 'seedance-riding-the-bear', 'seedance-best-friend', 'seedance-spilled-into-love', 'seedance-still-my-friend']) test(`reviewed generated/silent audio: ${id}`, () => assert.equal(templateAudioDependency(source(id)), false));
