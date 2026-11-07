import { TEMPLATE_CLIPS, publicTemplateClip } from '../app/veyrnox/_lib/templateClips.js';
import { TEMPLATE_CLIP_SOURCES } from './templateClipSources.js';
import { TEMPLATE_CLIP_MODEL, TEMPLATE_CLIP_ENDPOINT, validTemplateClipSource } from './templateClipGeneration.js';
import { capabilityFor } from './modelCapabilities.js';
import { freeAllowanceOn } from './freeJob.js';
import { select } from '../packages/db/supabase-client.js';

export function templateClipAvailable(id, { env = process.env, catalog, clips = TEMPLATE_CLIPS, manifest = TEMPLATE_CLIP_SOURCES } = {}) {
  if (env?.TEMPLATE_CLIP_ENABLED !== 'true' || !publicTemplateClip(id, clips)) return false;
  const row = Array.isArray(catalog) && catalog.find(item => item.id === TEMPLATE_CLIP_MODEL);
  if (!row || row.active !== true || row.gated_flag || row.provider_endpoint !== TEMPLATE_CLIP_ENDPOINT
      || !Object.hasOwn(manifest, id) || !validTemplateClipSource(id, manifest[id])) return false;
  const record = capabilityFor(row.provider_endpoint);
  return !!record?.media?.video?.serverOnly && record.provider === row.provider
    && Number.isInteger(row.credits_5s) && row.credits_5s > 0;
}

export async function loadTemplateClip(id, cfg, { env = process.env, clips = TEMPLATE_CLIPS, manifest = TEMPLATE_CLIP_SOURCES, read = select } = {}) {
  if (env?.TEMPLATE_CLIP_ENABLED !== 'true' || !publicTemplateClip(id, clips)) return null;
  let catalog;
  try {
    catalog = await read('model_catalog', { columns: `id,name,provider,provider_endpoint,modality,credits_5s,gated_flag,active${freeAllowanceOn(env) ? ',free_allowance_per_day' : ''}`, filter: `id=eq.${TEMPLATE_CLIP_MODEL}` }, cfg);
  } catch { return null; }
  if (!templateClipAvailable(id, { env, catalog, clips, manifest })) return null;
  const modelRow = catalog.find(row => row.id === TEMPLATE_CLIP_MODEL);
  return { template: { id, model: TEMPLATE_CLIP_MODEL, credits: modelRow.credits_5s, durationSeconds: 5 }, modelRow, source: { ...manifest[id] } };
}
