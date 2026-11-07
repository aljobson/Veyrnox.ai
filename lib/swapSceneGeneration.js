import { checkSource } from './modelCapabilities.js';
import { typeForKey } from './uploadSource.js';
import { presignGetUrl } from '../packages/adapters/r2.js';

export function checkSwapRequest(swap, body, references) {
  if (body.model_id !== swap.scene.swapOffer) return 'swap_model_mismatch';
  if (Object.hasOwn(body, 'video_url') || Object.hasOwn(body.inputs || {}, 'video_url')) return 'swap_video_not_allowed';
  const slots = references.map(ref => ref.slot || (ref.origin === 'asset' ? 'image' : typeForKey(ref.key)?.field?.replace(/_url$/, '')));
  if (slots.includes('video') || references.some(ref => ref.origin === 'upload' && typeForKey(ref.key)?.field === 'video_url')) return 'swap_video_not_allowed';
  if (slots.length !== swap.scene.people || slots.some(slot => slot !== 'image')) return 'swap_photo_count';
  return null;
}

export async function resolveSwapVideo(swap, record, r2cfg, sign = presignGetUrl) {
  const { source, scene } = swap;
  if (typeof source.key !== 'string' || !/^swap-scenes\/[a-zA-Z0-9/_-]+\.mp4$/.test(source.key)
      || typeof source.version !== 'string' || !source.version.length || !/^[a-f0-9]{64}$/.test(source.sha256)
      || source.contentType !== 'video/mp4') return { ok: false, error: 'swap_scene_not_found' };
  const metadata = { seconds: source.seconds, videoSeconds: source.videoSeconds,
    dimensions: { width: source.width, height: source.height }, contentType: source.contentType };
  const checked = checkSource(record, { video_url: metadata });
  if (!checked.ok) return checked;
  let signed;
  try { signed = await sign(source.key, 900, r2cfg); } catch { return { ok: false, error: 'internal' }; }
  return { ok: true, metadata, url: signed.url,
    identity: Object.freeze({ scene: scene.id, version: source.version, sha256: source.sha256 }) };
}
