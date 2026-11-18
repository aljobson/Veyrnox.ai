import { normaliseSwapRole } from './templateSwapClipRoles.mjs';
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
  if (slots.length !== 2 || slots.some(slot => slot !== 'image')) return 'template_swap_photo_count';
  if (body.consent !== true) return 'consent_required';
  if ([body.duration_seconds, body.inputs?.duration_seconds].some(value => value !== undefined && value !== 5)) return 'duration_not_supported';
  return null;
}

// The route prices exactly one 5 s unit (47 credits) and sends duration '5', so an admitted clip may not run longer than that unit (plus encode tolerance).
export const TEMPLATE_SWAP_CLIP_MAX_SECONDS = 5.05;

export function validTemplateSwapSource(id, source) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/.test(id)
    && !!source && !!normaliseSwapRole(source.role) && /^[a-f0-9]{64}$/.test(source.sha256)
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
    identity: Object.freeze({ template: clip.template.id, version: clip.source.version, sha256: clip.source.sha256, role: normaliseSwapRole(clip.source.role) }) };
}

// Host-read fal evidence, 2026-11-17: one element contains a frontal and an extra
// image. Only admission with a verified manifest may derive this private record.
export function templateSwapCapability(record, clip) {
  if (!validTemplateSwapSource(clip?.template?.id, clip?.source)) throw new Error('template_swap_not_found');
  return { ...record,
    inputs: { ...record.inputs, elements: { type: 'structured', serverOnly: true } },
    media: { ...record.media, image: { ...record.media.image, required: false, max: 2,
      verifiedAt: '2026-11-17',
      verification: 'https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/reference/api',
      priceVerification: 'https://fal.ai/models/fal-ai/kling-video/o1/video-to-video/reference' } },
    validate: inputs => {
      const elements = inputs.elements, element = elements?.[0];
      if (!Array.isArray(elements) || elements.length !== 1 || !element
          || Object.keys(element).sort().join(',') !== 'frontal_image_url,reference_image_urls'
          || typeof element.frontal_image_url !== 'string'
          || !Array.isArray(element.reference_image_urls) || element.reference_image_urls.length !== 1
          || typeof element.reference_image_urls[0] !== 'string' || inputs.image_url !== undefined) {
        return { ok: false, error: 'inputs_invalid:elements' };
      }
      return record.validate ? record.validate(inputs) : { ok: true };
    },
  };
}

export function checkTemplateSwapImages(sources) {
  const images = sources.image_url;
  if (!Array.isArray(images) || images.length !== 2 || images.some(image => {
    const { width, height } = image?.dimensions || {};
    return !Number.isInteger(width) || !Number.isInteger(height) || width < 300 || height < 300
      || width / height < 0.40 || width / height > 2.50;
  })) return { ok: false, error: 'template_swap_image_size' };
  return { ok: true };
}
