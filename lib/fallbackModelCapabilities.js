import { veoI2vOffer } from './veoI2v.js';
/**
 * Browser fallback capabilities, derived from the same registry the gateway and live
 * catalog use. Keeping only the id-to-endpoint join here prevents hand-copied media
 * slots, aspects and prompt rules drifting when the provider contract changes.
 */
import { capabilityFor, publicCapabilities } from './modelCapabilities.js';

export const FALLBACK_MODEL_ENDPOINTS = Object.freeze({
  'swap-recast': 'fal-ai/minimax-h3-max-recast',
  'swap-quick': 'crun:wan/2-2-animate-replace',
  'kling-o1-reference': 'fal-ai/kling-video/o1/video-to-video/reference',
  'seedance-2.0-reference': 'crun:bytedance/seedance2-0-r2v',
  'seedance-2.0-photo-kie': 'market:bytedance/seedance-2', // Dark long-prompt template offer (lib/seedanceLongTemplates.js).
  'wan-2.5-kie': 'market:wan/2-5-text-to-video',
  'kling-2.6-pro-kie': 'market:kling-2.6/text-to-video',
  'kling-3.0-i2v': 'fal-ai/kling-video/v3/pro/image-to-video',
  'kling-3.0-standard-i2v': 'fal-ai/kling-video/v3/standard/image-to-video',
  'seedance-2.0-fast': 'crun:bytedance/seedance2-0-fast-t2v',
  'kling-avatar-v2': 'crun:kling/avatar',
  latentsync: 'fal-ai/latentsync',
  'hailuo-02-kie': 'market:hailuo/02-text-to-video-standard',
  'veo-3.1-kie': 'crun:google/veo3-1-t2v',
  'veo-3.1-fast-kie': 'crun:google/veo3-1-fast-t2v',
  'veo-3.1-lite-kie': 'crun:google/veo3-1-lite-t2v',
  'nano-banana-pro-grsai': 'grsai:nano-banana-pro',
  'nano-banana-pro-edit': 'fal-ai/nano-banana-pro/edit',
  'nano-banana-kie': 'market:google/nano-banana',
  'sana-1.5-4.8b': 'fal-ai/sana/v1.5/4.8b',
  'flux-2-pro': 'crun:flux-2-pro',
  'background-remove-fast': 'crun:image-background-remove',
  'upscale-2x-clean': 'crun:image-upscale',
  'seedream-4': 'fal-ai/bytedance/seedream/v4/text-to-image',
  'topaz-upscale': 'fal-ai/topaz/upscale/image',
  'bria-bg-remove': 'fal-ai/bria/background/remove',
  'bria-expand': 'fal-ai/bria/expand',
  'ace-step': 'fal-ai/ace-step',
  'ace-step-1.5': 'fal-ai/ace-step-1.5',
  'ace-step-loop': 'fal-ai/ace-step-1.5', // Private operation; never added to public fallback tokens.
  'suno-sounds': 'crun:suno/sounds-generate',
});

// Contract-scoped route copies are not selected by the legacy active-offer
// fallback above. Keeping the inactive Suno endpoint here lets contract-aware
// callers validate it without changing today's fal fallback.
export const FALLBACK_CONTRACT_ENDPOINTS = Object.freeze({
  'crun-suno-v1': 'crun:suno/music-generate',
});

export function fallbackCapabilitiesFor(modelId) {
  const record = capabilityFor(FALLBACK_MODEL_ENDPOINTS[modelId]);
  // Offline defaults have no fresh parity or route evidence; only the live catalog may expose a Veo image slot.
  return publicCapabilities(veoI2vOffer(modelId) && record ? { ...record, media: {} } : record);
}
