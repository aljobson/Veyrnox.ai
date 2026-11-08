import { TEMPLATE_CLIPS, publicTemplateClip } from '../app/veyrnox/_lib/templateClips.js';
import { TEMPLATE_CLIP_SOURCES } from './templateClipSources.js';
import { TEMPLATE_CLIP_MODELS, validTemplateClipSource, checkTemplateClipVideoSource } from './templateClipGeneration.js';
import { capabilityFor } from './modelCapabilities.js';
import { freeAllowanceOn } from './freeJob.js';
import { select } from '../packages/db/supabase-client.js';

function selectedModel(id, { env = process.env, catalog, clips = TEMPLATE_CLIPS, manifest = TEMPLATE_CLIP_SOURCES } = {}) {
  if (env?.TEMPLATE_CLIP_ENABLED !== 'true' || !publicTemplateClip(id, clips)
      || !Object.hasOwn(manifest, id) || !validTemplateClipSource(id, manifest[id])) return null;
  for (const [model, endpoint] of Object.entries(TEMPLATE_CLIP_MODELS)) {
    const row = Array.isArray(catalog) && catalog.find(item => item.id === model);
    if (!row || row.active !== true || row.gated_flag || row.provider_endpoint !== endpoint) continue;
    const record = capabilityFor(endpoint);
    if (!record?.media?.video?.serverOnly || record.provider !== row.provider
        || !Number.isInteger(row.credits_5s) || row.credits_5s <= 0) continue;
    // Fal keeps its existing projection behavior; kie must prove every measured bound.
    if (row.provider === 'kie' && !checkTemplateClipVideoSource(id, manifest[id], record).ok) continue;
    return row;
  }
  return null;
}

export function templateClipAvailable(id, options = {}) {
  return !!selectedModel(id, options);
}

export async function loadTemplateClip(id, cfg, { env = process.env, clips = TEMPLATE_CLIPS, manifest = TEMPLATE_CLIP_SOURCES, read = select } = {}) {
  if (env?.TEMPLATE_CLIP_ENABLED !== 'true' || !publicTemplateClip(id, clips)) return null;
  let catalog;
  try {
    catalog = await read('model_catalog', { columns: `id,name,provider,provider_endpoint,modality,credits_5s,gated_flag,active${freeAllowanceOn(env) ? ',free_allowance_per_day' : ''}`, filter: `id=in.(${Object.keys(TEMPLATE_CLIP_MODELS).join(',')})` }, cfg);
  } catch { return null; }
  const modelRow = selectedModel(id, { env, catalog, clips, manifest });
  if (!modelRow) return null;
  return { template: { id, model: modelRow.id, credits: modelRow.credits_5s, durationSeconds: 5 }, modelRow, source: { ...manifest[id] } };
}
