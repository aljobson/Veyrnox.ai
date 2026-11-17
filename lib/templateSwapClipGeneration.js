import { TEMPLATE_SWAP_CLIP_MODEL } from '../app/veyrnox/_lib/templateSwapClips.js';
import { clientTemplateVideo } from './templateClipGeneration.js';
import { checkSource } from './modelCapabilities.js';
import { typeForKey } from './uploadSource.js';
import { presignGetUrl } from '../packages/adapters/r2.js';

export function checkTemplateSwapRequest(body, references, modelId = body.model_id) {
  if (['template_swap', 'template_clip', 'swap'].filter(key => Object.hasOwn(body, key)).length > 1) return 'template_source_conflict';
  if (body.model_id !== TEMPLATE_SWAP_CLIP_MODEL || body.model_id !== modelId) return 'template_swap_model_mismatch';
  if (clientTemplateVideo(body)) return 'template_swap_video_not_allowed';
  const slots = references.map(ref => ref.slot || (ref.origin === 'asset' ? 'image' : typeForKey(ref.key)?.field?.replace(/_url$/, '')));
  if (slots.length !== 1 || slots[0] !== 'image') return 'template_swap_photo_count';
  if (body.consent !== true) return 'consent_required';
  if ([body.duration_seconds, body.inputs?.duration_seconds].some(value => value !== undefined && value !== 5)) return 'duration_not_supported';
  return null;
}

// The route prices exactly one 5 s unit (47 credits) and sends duration '5', so an admitted clip may not run longer than that unit (plus encode tolerance).
export const TEMPLATE_SWAP_CLIP_MAX_SECONDS = 5.05;

export function validTemplateSwapSource(id, source) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(id)
    && !!source && /^[a-f0-9]{64}$/.test(source.sha256)
    && source.key === `template-swap-clips/${id}/${source.sha256}.mp4`
    && typeof source.version === 'string' && source.version.length > 0 && source.version.length <= 128
    && source.contentType === 'video/mp4'
    && [source.seconds, source.videoSeconds].every(value => Number.isFinite(value) && value >= 3 && value <= TEMPLATE_SWAP_CLIP_MAX_SECONDS)
    && [source.width, source.height].every(value => Number.isInteger(value) && value >= 720 && value <= 2160)
    && Number.isSafeInteger(source.sizeBytes) && source.sizeBytes > 0
    && Number.isFinite(source.frameRate) && source.frameRate > 0;
}

export function checkTemplateSwapVideoSource(id, source, record) {
  if (!validTemplateSwapSource(id, source) || !record?.media?.video) return { ok: false, error: 'template_swap_not_found' };
  const metadata = { seconds: source.seconds, videoSeconds: source.videoSeconds,
    dimensions: { width: source.width, height: source.height }, contentType: source.contentType,
    sizeBytes: source.sizeBytes, frameRate: source.frameRate };
  const checked = checkSource(record, { video_url: metadata });
  return checked.ok ? { ok: true, metadata } : checked;
}

export async function resolveTemplateSwapVideo(clip, record, r2cfg, sign = presignGetUrl) {
  const checked = checkTemplateSwapVideoSource(clip.template.id, clip.source, record);
  if (!checked.ok) return checked;
  let signed;
  try { signed = await sign(clip.source.key, 900, r2cfg); } catch { return { ok: false, error: 'internal' }; }
  return { ok: true, metadata: checked.metadata, url: signed.url,
    identity: Object.freeze({ template: clip.template.id, version: clip.source.version, sha256: clip.source.sha256 }) };
}
