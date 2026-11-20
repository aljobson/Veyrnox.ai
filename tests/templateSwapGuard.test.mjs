import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { swapNeedsSourceVideo } from '../lib/templateSwapGuard.js';
import { checkTemplateRequest } from '../lib/templateFidelity.js';
import { templateContract } from '../lib/templateContract.js';

// Swap recipes ("Replace the main character with <<<image_1>>>") only work on the template's own source clip. Kling image-to-video
// has no video input, so the run returns the user's photo with almost no motion. They are refused before any debit.

test('swap, replace and change-X-to-photo prompts need a source video', () => {
  for (const p of [
    'Replace the main character with <<<image_1>>> Person.',
    'replace man in video with <<<image_1>>>',
    'Keep the scene the same; just change the man sitting on the couch with <<<image_1>>>',
    'In the referenced video, imitate the woman, but replace her face with the face from the reference',
    'Swap out the main character in the video and use the image provided.',
    'Change character to <<<image_1>>> scene 1980s Czechoslovakia',
    'Character swapthe guy who gets blown up from the chair replace with <<<image_1>>>',
    'change the player with the ball to the person on the picture i uploaded',
  ]) assert.equal(swapNeedsSourceVideo(p), true, p);
});

// 18 Nov 2026 audit of the listed templates: five edit-the-video prompts passed the guard and would have charged for a photo that barely moves.
test('passive and plural replace, "in the video" and a leading Swap are swaps too', () => {
  for (const p of [
    'A high-quality cinematic video where the male driver inside the car is completely replaced by the man from <<<image_1>>>. Keep the exact background.',
    '<<<image_1>>> replaces guy with blonde hair at the head of the table\n\nRemove all text and watermarks',
    'when guy dancing ing the video with <<<image_1>>>  copy all motion.',
    '<<<image_1>>>  is the character in the video',
    'Swap a location and the character \n<<<image_1>>> - location \n - actor\n - second look',
  ]) assert.equal(swapNeedsSourceVideo(p), true, p);
});

test('wording that only mentions a video, a hairstyle or the photo is still not a swap', () => {
  for (const p of [
    "Preserve the exact facial features, hair colour and hairstyle shown in @image1. Do not replace the hairstyle with a generic ballet bun.",
    "do not change, alter, or restyle their clothing at any point in the video, even inside the tent",
    'Put me dressed in designer swim trunks using my picture <<<image_1>>>',
    '<<<image_1>>> For my character don’t change is hair and his face and his body',
    'The character from <<<image_1>>> is the one doing the slap',
    'A character walks through the video wall of a gallery.',
    'No text or logo may be changed or replaced, and it must be exactly the same as @Image2.',
    'The WITCH filter is completely replaced by the ZOMBIE filter. Keep @image1 as the exact reference.',
  ]) assert.equal(swapNeedsSourceVideo(p), false, p);
});

test('negated, incidental and camera wording is not a swap', () => {
  for (const p of [
    'DO NOT REPLACE THE FACE WITH ANOTHER FEMALE CHARACTER. Use the exact face from the provided photograph.',
    "Do not replace my face with a generic model's face.",
    'Then the camera moves in. Switch to a close-up. Hair colour or hair length change between cuts is not allowed.',
    'Running through the forest, same forest, same motion, change the scene to night.',
    'A woman walks along a beach at sunset.',
    '',
    undefined,
  ]) assert.equal(swapNeedsSourceVideo(p), false, String(p));
});

const heroStrut = () => templateContract('community-action-hero-strut');

test('Action Hero Strut is refused by template id and by preset, before any debit', () => {
  const c = heroStrut();
  assert.equal(swapNeedsSourceVideo(c.sourcePrompt), true);
  const inputs = { prompt: c.prompt, aspect_ratio: c.aspect, duration_seconds: c.duration, negative_prompt: c.negativePrompt };
  assert.deepEqual(checkTemplateRequest({ template_id: c.id, model_id: 'kling-3.0-i2v', inputs }), { ok: false, error: 'template_blocked' });
  assert.deepEqual(checkTemplateRequest({ preset: c.id, model_id: 'kling-3.0-i2v', inputs }), { ok: false, error: 'template_blocked' });
  // No prompt sent: the server fills in the template's own text, so it is the same run.
  assert.deepEqual(checkTemplateRequest({ template_id: c.id, model_id: 'kling-3.0-i2v', inputs: {} }), { ok: false, error: 'template_blocked' });
});

test('a prompt the user rewrote is a custom run, not the template, and is not refused here', () => {
  const c = heroStrut();
  const r = checkTemplateRequest({ template_id: c.id, model_id: 'kling-3.0-i2v', inputs: { prompt: 'A man in a suit walks down a street at night.' } });
  assert.notEqual(r.error, 'template_blocked');
});

test('every swap template is on the video-needing side; no photo-only template is caught', () => {
  const ids = Object.values(JSON.parse(fs.readFileSync(new URL('../lib/publicTemplateIds.json', import.meta.url), 'utf8'))).flat().filter(x => typeof x === 'string');
  let caught = 0;
  for (const id of ids) {
    const c = templateContract(id);
    // Already-blocked templates are refused by the video guard; this gate only adds the rest.
    if (!c || c.class === 'blocked-needs-video' || !swapNeedsSourceVideo(c.sourcePrompt)) continue;
    caught++;
    const r = checkTemplateRequest({ template_id: id, model_id: 'kling-3.0-i2v', inputs: { prompt: c.prompt } });
    assert.equal(r.error, 'template_blocked', id);
  }
  // Pinned so a regex edit that silently widens or narrows the gate shows up in review. Update with the reviewed id list.
  assert.ok(caught >= 100 && caught <= 140, `caught ${caught}`);
  for (const keep of ['community-dragon-rider-encounter', 'community-gothic-duelist-descent', 'community-locker-room-duet',
    'community-luxury-sedan-arrival', 'office-kitchen', 'community-midnight-forest-run', 'theater-ceiling-horror']) {
    assert.equal(swapNeedsSourceVideo(templateContract(keep).sourcePrompt), false, keep);
  }
});
