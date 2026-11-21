import { templateSwapSwitchOn } from './appRuntime.js';
import { templateSwapPeopleRoles } from './templateSwapPeople.mjs';
import { templateSwapFullBodyOn } from './templateSwapFullBody.mjs';
import { effectiveSwapRole } from './templateSwapRoleOverrides.mjs';
import { TEMPLATE_SWAP_CLIPS, TEMPLATE_SWAP_CLIP_MANIFEST_SHA256, TEMPLATE_SWAP_CLIP_MODEL, TEMPLATE_SWAP_CLIP_ENDPOINT } from '../app/veyrnox/_lib/templateSwapClips.js';
import { loadTemplateSwapClipManifest } from './templateSwapClipManifest.js';
import { envConfig as r2EnvConfig } from '../packages/adapters/r2.js';
import { checkTemplateSwapVideoSource } from './templateSwapClipGeneration.js';
import { capabilityFor } from './modelCapabilities.js';
import { freeAllowanceOn } from './freeJob.js';
import { select } from '../packages/db/supabase-client.js';

function registered(id, env, registry) {
  // No template-contract lookup here: /api/catalog is its own route bundle and importing the contracts JSON copied ~770 KiB into the
  // Worker. Registry ids are swap templates by construction (the importer only emits eligible ids; tests/templateSwapClipEmpty pins it).
  return env?.MULTI_REFERENCE_ENABLED === 'true' && templateSwapSwitchOn(env) && typeof id === 'string' && registry.includes(id);
}

export function templateSwapAvailable(id, { env = process.env, catalog, registry = TEMPLATE_SWAP_CLIPS, manifest = null } = {}) {
  if (!registered(id, env, registry) || !manifest || !Object.hasOwn(manifest, id)) return null;
  const modelRow = Array.isArray(catalog) && catalog.find(row => row.id === TEMPLATE_SWAP_CLIP_MODEL);
  if (!modelRow || modelRow.active !== true || modelRow.gated_flag || modelRow.provider_endpoint !== TEMPLATE_SWAP_CLIP_ENDPOINT
      || !Number.isInteger(modelRow.credits_5s) || modelRow.credits_5s <= 0) return null;
  const record = capabilityFor(modelRow.provider_endpoint);
  if (!record || record.provider !== modelRow.provider || !checkTemplateSwapVideoSource(id, manifest[id], record).ok) return null;
  // Two-person (amendment 14): only with the templateSwapPeople key on and a reviewed role pair; otherwise the projection is byte-for-byte the one-person one.
  const roles = templateSwapPeopleRoles(id, env);
  // The reviewed role (amendment 16) replaces the manifest's for the projection, the prompt and the job identity alike.
  const role = effectiveSwapRole(id, manifest[id].role);
  if (!role) return null;
  const base = { id, model: modelRow.id, credits: modelRow.credits_5s, durationSeconds: 5, role };
  // Full body (amendment 18): one-person clips only. `images` stays 2 so clients that do not know `fullBody` keep working.
  const template = roles ? { ...base, role: roles[0], roles, people: 2, images: 4 }
    : templateSwapFullBodyOn(env) ? { ...base, images: 2, fullBody: true } : { ...base, images: 2 };
  return { template, modelRow, source: { ...manifest[id], role } };
}

export async function loadTemplateSwapClip(id, cfg, { env = process.env, registry = TEMPLATE_SWAP_CLIPS, readManifest = loadTemplateSwapClipManifest, r2cfg = r2EnvConfig(), read = select } = {}) {
  if (!registered(id, env, registry)) return null;
  const manifest = await readManifest(TEMPLATE_SWAP_CLIP_MANIFEST_SHA256, r2cfg);
  if (!manifest || !Object.hasOwn(manifest, id)) return null;
  let catalog;
  try {
    catalog = await read('model_catalog', { columns: `id,provider,provider_endpoint,modality,credits_5s,gated_flag,active${freeAllowanceOn(env) ? ',free_allowance_per_day' : ''}`, filter: `id=eq.${TEMPLATE_SWAP_CLIP_MODEL}` }, cfg);
  } catch { return null; }
  return templateSwapAvailable(id, { env, catalog, registry, manifest });
}

/** `{ id, credits }` for each of `ids` that is live right now, from one manifest read and one catalog read (the row on the home screens). [] while the switch is off. */
export async function loadTemplateSwapRow(ids, cfg, { env = process.env, registry = TEMPLATE_SWAP_CLIPS, readManifest = loadTemplateSwapClipManifest, r2cfg = r2EnvConfig(), read = select } = {}) {
  const wanted = (Array.isArray(ids) ? ids : []).filter(id => registered(id, env, registry));
  if (!wanted.length) return [];
  const manifest = await readManifest(TEMPLATE_SWAP_CLIP_MANIFEST_SHA256, r2cfg);
  if (!manifest) return [];
  let catalog;
  try {
    catalog = await read('model_catalog', { columns: `id,provider,provider_endpoint,modality,credits_5s,gated_flag,active${freeAllowanceOn(env) ? ',free_allowance_per_day' : ''}`, filter: `id=eq.${TEMPLATE_SWAP_CLIP_MODEL}` }, cfg);
  } catch { return []; }
  return wanted.flatMap(id => { const live = templateSwapAvailable(id, { env, catalog, registry, manifest }); return live ? [{ id, credits: live.template.credits }] : []; });
}
