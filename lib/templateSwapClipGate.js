import { TEMPLATE_SWAP_CLIPS, TEMPLATE_SWAP_CLIP_MODEL, TEMPLATE_SWAP_CLIP_ENDPOINT } from '../app/veyrnox/_lib/templateSwapClips.js';
import { TEMPLATE_SWAP_CLIP_SOURCES } from './templateSwapClipSources.js';
import { checkTemplateSwapVideoSource } from './templateSwapClipGeneration.js';
import { templateContract } from './templateContract.js';
import { swapNeedsSourceVideo } from './templateSwapGuard.js';
import { capabilityFor } from './modelCapabilities.js';
import { freeAllowanceOn } from './freeJob.js';
import { select } from '../packages/db/supabase-client.js';

function registered(id, env, registry) {
  if (env?.TEMPLATE_SWAP_CLIP_ENABLED !== 'true' || typeof id !== 'string' || !registry.includes(id)) return false;
  const contract = templateContract(id);
  return !!contract && contract.class !== 'blocked-needs-video' && swapNeedsSourceVideo(contract.sourcePrompt);
}

export function templateSwapAvailable(id, { env = process.env, catalog, registry = TEMPLATE_SWAP_CLIPS, manifest = TEMPLATE_SWAP_CLIP_SOURCES } = {}) {
  if (!registered(id, env, registry) || !Object.hasOwn(manifest, id)) return null;
  const modelRow = Array.isArray(catalog) && catalog.find(row => row.id === TEMPLATE_SWAP_CLIP_MODEL);
  if (!modelRow || modelRow.active !== true || modelRow.gated_flag || modelRow.provider_endpoint !== TEMPLATE_SWAP_CLIP_ENDPOINT
      || !Number.isInteger(modelRow.credits_5s) || modelRow.credits_5s <= 0) return null;
  const record = capabilityFor(modelRow.provider_endpoint);
  if (!record || record.provider !== modelRow.provider || !checkTemplateSwapVideoSource(id, manifest[id], record).ok) return null;
  return { template: { id, model: modelRow.id, credits: modelRow.credits_5s, durationSeconds: 5 }, modelRow, source: { ...manifest[id] } };
}

export async function loadTemplateSwapClip(id, cfg, { env = process.env, registry = TEMPLATE_SWAP_CLIPS, manifest = TEMPLATE_SWAP_CLIP_SOURCES, read = select } = {}) {
  if (!registered(id, env, registry)) return null;
  let catalog;
  try {
    catalog = await read('model_catalog', { columns: `id,provider,provider_endpoint,modality,credits_5s,gated_flag,active${freeAllowanceOn(env) ? ',free_allowance_per_day' : ''}`, filter: `id=eq.${TEMPLATE_SWAP_CLIP_MODEL}` }, cfg);
  } catch { return null; }
  return templateSwapAvailable(id, { env, catalog, registry, manifest });
}
