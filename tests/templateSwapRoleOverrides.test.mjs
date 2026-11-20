import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATE_SWAP_ROLE_OVERRIDES, effectiveSwapRole } from '../lib/templateSwapRoleOverrides.mjs';
import { normaliseSwapRole } from '../lib/templateSwapClipRoles.mjs';
import { templateSwapAvailable } from '../lib/templateSwapClipGate.js';
import { resolveTemplateSwapVideo } from '../lib/templateSwapClipGeneration.js';
import { templateSwapPrompt } from '../lib/templateSwapClipPrompt.mjs';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { TEMPLATE_SWAP_CLIPS } from '../app/veyrnox/_lib/templateSwapClips.js';
import { source, catalog } from './fixtures/templateSwapClips.mjs';
const env = { MULTI_REFERENCE_ENABLED: 'true', TEMPLATE_SWAP_CLIP_ENABLED: 'true' };
const ID = 'community-office-orbit-sequence', NEW = 'the older woman in sunglasses and the red fur coat';
const clip = id => ({ ...source, role: 'the cat', key: `template-swap-clips/${id}/${source.sha256}.mp4` });

test('every reviewed role is a usable, distinct-from-default role for a live one-photo id', () => {
  const entries = Object.entries(TEMPLATE_SWAP_ROLE_OVERRIDES);
  assert.equal(entries.length, 21);
  for (const [id, role] of entries) {
    assert.ok(TEMPLATE_SWAP_CLIPS.includes(id), `${id} is in the live registry`);
    const safe = normaliseSwapRole(role);
    assert.ok(safe, `${id}: role survives normalisation`);
    assert.notEqual(safe, 'the main character');
    assert.ok(templateSwapPrompt(safe).includes(`Change ${safe} in @Video1 to @Element1.`));
  }
});

test('a listed id uses its reviewed role; any other id keeps the manifest role', () => {
  assert.equal(effectiveSwapRole(ID, 'the cat'), NEW);
  assert.equal(effectiveSwapRole('community-action-hero-strut', 'The Main  Character'), 'the main character');
  assert.equal(effectiveSwapRole('__proto__', 'the man'), 'the man');
  assert.equal(effectiveSwapRole('x', 'the cat', { x: 'bad\nrole' }), null);
});

test('the gate projects, prompts and records the reviewed role, never the manifest one', async () => {
  const live = templateSwapAvailable(ID, { env, catalog, registry: [ID], manifest: { [ID]: clip(ID) } });
  assert.equal(live.template.role, NEW);
  assert.equal(live.source.role, NEW);
  assert.equal(live.template.images, 2);
  const resolved = await resolveTemplateSwapVideo(live, capabilityFor(catalog[0].provider_endpoint), {}, async () => ({ url: 'signed' }));
  assert.equal(resolved.identity.role, NEW);
  const other = 'community-action-hero-strut';
  assert.equal(templateSwapAvailable(other, { env, catalog, registry: [other], manifest: { [other]: { ...source, role: 'the main character' } } }).template.role, 'the main character');
});
