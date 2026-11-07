import { SWAP_SCENES, publicSwapScene } from '../app/veyrnox/_lib/swapScenes.js';
import { SWAP_SCENE_SOURCES } from './swapSceneSources.js';
import { capabilityFor } from './modelCapabilities.js';
import { effectiveMaxFiles } from './multiReference.mjs';
import { freeAllowanceOn } from './freeJob.js';
import { select } from '../packages/db/supabase-client.js';

export function swapSceneAvailable(id, { env = process.env, catalog, scenes = SWAP_SCENES, manifest = SWAP_SCENE_SOURCES } = {}) {
  if (env?.APP_ENV !== 'staging' || typeof id !== 'string') return false;
  const scene = publicSwapScene(id, scenes);
  const row = Array.isArray(catalog) && catalog.find(item => item.id === scene?.swapOffer);
  if (!scene || !['swap-recast', 'swap-quick'].includes(scene.swapOffer)
      || ![1, 2].includes(scene.people) || !row || row.active !== true || row.gated_flag
      || !Object.hasOwn(manifest, id) || !manifest[id]) return false;
  const record = capabilityFor(row.provider_endpoint);
  return !!record?.media?.image && record.provider === row.provider
    && scene.people <= effectiveMaxFiles(record.media.image, env);
}

// Config and admission use the same fail-closed lookup. Catalog failure reveals
// no distinction from an unpublished/unknown scene. Never use static fallback rows.
export async function loadSwapScene(id, cfg, { env = process.env, scenes = SWAP_SCENES, manifest = SWAP_SCENE_SOURCES, read = select } = {}) {
  const scene = publicSwapScene(id, scenes);
  if (env?.APP_ENV !== 'staging' || !scene) return null;
  let catalog;
  try {
    catalog = await read('model_catalog', { columns: `id,name,provider,provider_endpoint,modality,credits_5s,gated_flag,active${freeAllowanceOn(env) ? ',free_allowance_per_day' : ''}`, filter: `id=eq.${encodeURIComponent(scene.swapOffer)}` }, cfg);
  } catch { return null; }
  if (!swapSceneAvailable(id, { env, catalog, scenes, manifest })) return null;
  const modelRow = catalog.find(row => row.id === scene.swapOffer);
  if (!Number.isInteger(modelRow.credits_5s) || modelRow.credits_5s <= 0) return null;
  return { scene: { ...scene, credits: modelRow.credits_5s }, modelRow, source: { ...manifest[id] } };
}
