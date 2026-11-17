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
