import { TEMPLATE_CLIP_MODELS, isTemplateClipModel } from '../app/veyrnox/_lib/templateClips.js';
export { TEMPLATE_CLIP_MODELS };
import { checkSource } from './modelCapabilities.js';
import { typeForKey } from './uploadSource.js';
import { presignGetUrl } from '../packages/adapters/r2.js';

export const TEMPLATE_CLIP_MODEL = 'seedance-2.0-reference';
export const TEMPLATE_CLIP_ENDPOINT = TEMPLATE_CLIP_MODELS[TEMPLATE_CLIP_MODEL];
export function clientTemplateVideo(body) {
  if ([body, body?.inputs].some(value => value && ['video', 'video_url', 'video_urls'].some(key => Object.hasOwn(value, key)))) return true;
  const refs = [...(Array.isArray(body?.references) ? body.references : []),
    ...(Array.isArray(body?.source_keys) ? body.source_keys : []),
    ...(Array.isArray(body?.source_assets) ? body.source_assets : []), body?.source_key];
  return refs.some(ref => ref?.slot === 'video' || typeForKey(typeof ref === 'string' ? ref : ref?.key)?.field === 'video_url');
}

export function checkTemplateClipRequest(body, references, selectedModel = body.model_id) {
  if (!isTemplateClipModel(body.model_id) || body.model_id !== selectedModel || body.swap !== undefined) return 'template_clip_model_mismatch';
  if (clientTemplateVideo(body)) return 'template_clip_video_not_allowed';
  const slots = references.map(ref => ref.slot || (ref.origin === 'asset' ? 'image' : typeForKey(ref.key)?.field?.replace(/_url$/, '')));
  if (body.model_id === 'seedance-2.0-reference-kie' && slots.filter(slot => slot === 'image').length > 1) return 'source_count_exceeded';
  if (slots.length !== 1 || slots[0] !== 'image') return 'template_clip_photo_count';
  if (body.consent !== true) return 'consent_required';
  if (body.inputs?.duration_seconds !== undefined && body.inputs.duration_seconds !== 5) return 'duration_not_supported';
  return null;
}

export function validTemplateClipSource(id, source) {
  return !!source && /^[a-f0-9]{64}$/.test(source.sha256)
    && source.key === `template-clips/${id}/${source.sha256}.mp4`
    && typeof source.version === 'string' && source.version.length > 0 && source.version.length <= 128
    && source.contentType === 'video/mp4'
    && [source.seconds, source.videoSeconds].every(value => Number.isFinite(value) && value > 0)
    && [source.width, source.height].every(value => Number.isInteger(value) && value > 0);
}

// Pure manifest validation shared by kie availability and trusted admission.
export function checkTemplateClipVideoSource(id, source, record) {
  if (!validTemplateClipSource(id, source) || !record?.media?.video?.serverOnly) return { ok: false, error: 'template_clip_not_found' };
  const metadata = { seconds: source.seconds, videoSeconds: source.videoSeconds,
    dimensions: { width: source.width, height: source.height }, contentType: source.contentType,
    sizeBytes: source.sizeBytes, frameRate: source.frameRate };
  const checked = checkSource(record, { video_url: metadata });
  return checked.ok ? { ok: true, metadata } : checked;
}

export async function resolveTemplateClipVideo(clip, record, r2cfg, sign = presignGetUrl) {
  const { source, template } = clip;
  const checked = checkTemplateClipVideoSource(template.id, source, record);
  if (!checked.ok) return checked;
  const { metadata } = checked;
  let signed;
  try { signed = await sign(source.key, 900, r2cfg); } catch { return { ok: false, error: 'internal' }; }
  return { ok: true, metadata, url: signed.url,
    identity: Object.freeze({ template: template.id, version: source.version, sha256: source.sha256 }) };
}
