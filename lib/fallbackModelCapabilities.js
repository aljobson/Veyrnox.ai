/**
 * Browser fallback capabilities, derived from the same registry the gateway and live
 * catalog use. Keeping only the id-to-endpoint join here prevents hand-copied media
 * slots, aspects and prompt rules drifting when the provider contract changes.
 */
import { capabilityFor, publicCapabilities } from './modelCapabilities.js';

export const FALLBACK_MODEL_ENDPOINTS = Object.freeze({
  'wan-2.5-kie': 'market:wan/2-5-text-to-video',
  'kling-2.6-pro-kie': 'market:kling-2.6/text-to-video',
  'kling-3.0-i2v': 'fal-ai/kling-video/v3/pro/image-to-video',
  'seedance-2.0-fast': 'bytedance/seedance-2.0-fast',
  'kling-avatar-v2': 'fal-ai/kling-video/ai-avatar/v2/standard',
  latentsync: 'fal-ai/latentsync',
  'hailuo-02-kie': 'market:hailuo/02-text-to-video-standard',
  'veo-3.1-kie': 'veo:veo3',
  'veo-3.1-fast-kie': 'veo:veo3_fast',
  'veo-3.1-lite-kie': 'veo:veo3_lite',
  'nano-banana-pro-grsai': 'grsai:nano-banana-pro',
  'nano-banana-pro-edit': 'fal-ai/nano-banana-pro/edit',
  'nano-banana-kie': 'market:google/nano-banana',
  'sana-1.5-4.8b': 'fal-ai/sana/v1.5/4.8b',
  'flux-2-pro': 'fal-ai/flux-2-pro',
  'seedream-4': 'fal-ai/bytedance/seedream/v4/text-to-image',
  'topaz-upscale': 'fal-ai/topaz/upscale/image',
  'bria-bg-remove': 'fal-ai/bria/background/remove',
  'bria-expand': 'fal-ai/bria/expand',
  'ace-step': 'fal-ai/ace-step',
  'ace-step-1.5': 'fal-ai/ace-step-1.5',
  'elevenlabs-sfx-v2': 'fal-ai/elevenlabs/sound-effects/v2',
  'mmaudio-v2': 'fal-ai/mmaudio-v2/text-to-audio',
  'elevenlabs-tts-turbo': 'fal-ai/elevenlabs/tts/turbo-v2.5',
  'minimax-speech-2.6-hd': 'fal-ai/minimax/speech-2.6-hd',
  'inworld-tts': 'fal-ai/inworld-tts',
  'zonos2-voice-clone': 'fal-ai/zonos2',
  'elevenlabs-dialogue': 'fal-ai/elevenlabs/text-to-dialogue/eleven-v3',
});

export function fallbackCapabilitiesFor(modelId) {
  return publicCapabilities(capabilityFor(FALLBACK_MODEL_ENDPOINTS[modelId]));
}
