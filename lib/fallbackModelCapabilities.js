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
  'veo-3.1-kie': 'veo:veo3',
  'veo-3.1-fast-kie': 'veo:veo3_fast',
  'veo-3.1-lite-kie': 'veo:veo3_lite',
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
  'elevenlabs-sfx-v2': 'fal-ai/elevenlabs/sound-effects/v2',
  'mmaudio-v2': 'fal-ai/mmaudio-v2/text-to-audio',
  'elevenlabs-tts-turbo': 'fal-ai/elevenlabs/tts/turbo-v2.5',
  'minimax-speech-2.6-hd': 'fal-ai/minimax/speech-2.6-hd',
  'inworld-tts': 'fal-ai/inworld-tts',
  'zonos2-voice-clone': 'fal-ai/zonos2',
  'elevenlabs-dialogue': 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3',
});

// Contract-scoped route copies are not selected by the legacy active-offer
// fallback above. Keeping the inactive Suno endpoint here lets contract-aware
// callers validate it without changing today's fal fallback.
export const FALLBACK_CONTRACT_ENDPOINTS = Object.freeze({
  'crun-suno-v1': 'crun:suno/music-generate',
});

export function fallbackCapabilitiesFor(modelId) {
  return publicCapabilities(capabilityFor(FALLBACK_MODEL_ENDPOINTS[modelId]));
}
