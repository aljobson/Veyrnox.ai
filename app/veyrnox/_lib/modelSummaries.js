import { MODELS } from './tokens.js';

const SUMMARY = {
  'wan-2.5-kie': 'Balanced text-to-video for flexible cinematic shots.',
  'kling-2.6-pro-kie': 'Polished motion and controlled cinematic scenes.',
  'kling-3.0-i2v': 'Animate a source image with strong motion control.',
  'seedance-2.0-fast': 'Fast multi-shot concepts with image guidance.',
  'kling-avatar-v2': 'Talking avatar from a portrait and supplied audio.',
  latentsync: 'Synchronise a source video to supplied audio.',
  'hailuo-02-kie': 'Affordable, expressive image-to-video.',
  'veo-3.1-kie': 'Premium cinematic video for high-stakes shots.',
  'veo-3.1-fast-kie': 'Faster cinematic video with strong prompt following.',
  'veo-3.1-lite-kie': 'Lower-cost Veo video for quick concepts.',
  'nano-banana-pro-grsai': 'Detailed image generation for fast iteration.',
  'nano-banana-pro-edit': 'Edit an existing image with written instructions.',
  'nano-banana-kie': 'Fast, low-cost image generation.',
  'sana-1.5-4.8b': 'Lowest-cost image exploration.',
  'flux-2-pro': 'Detailed, prompt-led image generation.',
  'seedream-4': 'High-resolution image concepts and artwork.',
  'topaz-upscale': 'Upscale an existing image by 2×.',
  'bria-bg-remove': 'Remove the background from an existing image.',
  'bria-expand': 'Expand an image into a new aspect ratio.',
  'ace-step': 'Generate a full music track from a prompt.',
  'ace-step-1.5': 'Higher-quality music with deeper prompt reasoning.',
  'elevenlabs-sfx-v2': 'Create a focused sound effect from words.',
  'mmaudio-v2': 'Add matching sound to a short source video.',
  'elevenlabs-tts-turbo': 'Fast natural speech from a script.',
  'minimax-speech-2.6-hd': 'High-definition expressive speech.',
  'inworld-tts': 'Low-cost speech for prototypes and narration.',
  'elevenlabs-dialogue': 'Multi-speaker dialogue from a named script.',
};

const BADGES = {
  'kling-3.0-i2v': ['IMAGE REF', '5 / 10S'],
  'kling-avatar-v2': ['IMAGE + AUDIO', '5S'],
  latentsync: ['VIDEO + AUDIO', 'LIP SYNC'],
  'nano-banana-pro-edit': ['IMAGE REF', 'EDIT'],
  'topaz-upscale': ['IMAGE REF', '2×'],
  'bria-bg-remove': ['IMAGE REF', 'CUTOUT'],
  'bria-expand': ['IMAGE REF', 'OUTPAINT'],
  'mmaudio-v2': ['VIDEO REF', 'SOUND'],
  'elevenlabs-dialogue': ['SCRIPT', 'MULTI-VOICE'],
};

const fallbackById = new Map(MODELS.map((model) => [model.id, model]));

export const FEATURED_MODEL_IDS = [
  'wan-2.5-kie',
  'kling-3.0-i2v',
  'veo-3.1-fast-kie',
  'nano-banana-pro-grsai',
  'flux-2-pro',
  'ace-step-1.5',
  'elevenlabs-dialogue',
  'bria-bg-remove',
];

export function featuredModels(models = MODELS) {
  const byId = new Map(models.map((model) => [model.id, model]));
  return FEATURED_MODEL_IDS.map((id) => byId.get(id)).filter(Boolean);
}

export function modelSummary(model) {
  if (!model) return '';
  return SUMMARY[model.id] || (model.kind === 'video'
    ? 'Create a video from your prompt and available references.'
    : model.kind === 'audio'
      ? 'Create audio from a written brief.'
      : 'Create an image from a written brief.');
}

export function modelTag(model) {
  if (!model) return null;
  return model.tag || fallbackById.get(model.id)?.tag || null;
}

export function modelBadges(model) {
  if (!model) return [];
  if (BADGES[model.id]) return BADGES[model.id];
  if (model.isSpeech) return ['SCRIPT', 'VOICE'];
  const durations = model.kind === 'video' && Array.isArray(model.durations)
    ? `${model.durations.join(' / ')}S`
    : null;
  return [model.kind === 'video' ? 'TEXT→VIDEO' : model.kind === 'audio' ? 'TEXT→AUDIO' : 'TEXT→IMAGE', durations]
    .filter(Boolean);
}
