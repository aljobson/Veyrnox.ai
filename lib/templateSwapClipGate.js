import { appRuntimeFlag, templateSwapSwitchOn } from './appRuntime.js';
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
import { TEMPLATE_SWAP_CRUN_MODEL, TEMPLATE_SWAP_CRUN_ENDPOINT, TEMPLATE_SWAP_CRUN_1080_MODEL, TEMPLATE_SWAP_CRUN_1080_ENDPOINT } from './privateModelIds.js';

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

/**
 * The catalog row a validated swap is charged and dispatched on (ADR-0351 amendment 21). Clients keep naming the public
 * offer. An absent or inactive private row means the public row, exactly as before; a row that is active but does not
 * match, or a failed read, refuses before any debit so a swap is never sent to a supplier by accident.
 * @returns {Promise<{ok:true,row:object}|{ok:false}>}
 */
export async function loadTemplateSwapDispatch(publicRow, cfg, { env = process.env, read = select } = {}) {
  // 1080p (amendment 22): own runtime key, absent = off. Off reads and dispatches exactly the 720p row.
  const hd = appRuntimeFlag('templateSwapCrun1080', env);
  let rows;
  try {
    rows = await read('model_catalog', { columns: `id,provider,provider_endpoint,modality,credits_5s,gated_flag,active${freeAllowanceOn(env) ? ',free_allowance_per_day' : ''}`, filter: hd ? `id=in.(${TEMPLATE_SWAP_CRUN_MODEL},${TEMPLATE_SWAP_CRUN_1080_MODEL})` : `id=eq.${TEMPLATE_SWAP_CRUN_MODEL}` }, cfg);
  } catch { return { ok: false }; }
  if (!Array.isArray(rows)) return { ok: false };
  const row = rows.find(candidate => candidate?.id === TEMPLATE_SWAP_CRUN_MODEL);
  if (!row || row.active !== true) return { ok: true, row: publicRow };
  const matches = (candidate, endpoint) => candidate.provider === 'crun' && candidate.provider_endpoint === endpoint && !candidate.gated_flag
    && candidate.modality === publicRow.modality && candidate.credits_5s === publicRow.credits_5s;
  if (!matches(row, TEMPLATE_SWAP_CRUN_ENDPOINT)) { console.error('[template-swap] private route row does not match the offer'); return { ok: false }; }
  const hdRow = hd ? rows.find(candidate => candidate?.id === TEMPLATE_SWAP_CRUN_1080_MODEL) : null;
  // An absent or inactive 1080p row keeps the 720p route; turning the 720p row off also stops 1080p.
  if (!hdRow || hdRow.active !== true) return { ok: true, row };
  if (!matches(hdRow, TEMPLATE_SWAP_CRUN_1080_ENDPOINT)) { console.error('[template-swap] private 1080p row does not match the offer'); return { ok: false }; }
  return { ok: true, row: hdRow };
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
