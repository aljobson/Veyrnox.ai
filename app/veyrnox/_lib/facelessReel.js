import { tOr } from '../../../lib/i18n/translate.mjs';

export const FACELESS_REEL_MODEL = 'wan-2.5-kie';

const fallbackTranslator = Object.assign((key) => key, { messages: {} });
const copy = (t, key, fallback) => tOr(t || fallbackTranslator, key, fallback);

export const FACELESS_REEL_FORMATS = Object.freeze([
  { id: 'explainer' },
  { id: 'list' },
  { id: 'micro-story' },
  { id: 'mood' },
]);

export const FACELESS_REEL_PACING = Object.freeze([
  { id: 'measured' },
  { id: 'balanced' },
  { id: 'fast' },
]);

export const FACELESS_REEL_PLATFORMS = Object.freeze([
  { id: 'reels', aspect: '9:16' },
  { id: 'shorts', aspect: '9:16' },
  { id: 'web', aspect: '16:9' },
]);

export function facelessReelFormatCopy(t, id) {
  const formats = {
    explainer: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.format.explainer.label', 'Visual explainer'),
      description: tOr(t || fallbackTranslator, 'app.facelessReel.format.explainer.description', 'One clear idea revealed through objects, places and purposeful motion.'),
      direction: tOr(t || fallbackTranslator, 'app.facelessReel.format.explainer.direction', 'Build one visually legible explanation with a clear setup, reveal and resolved final frame.'),
    },
    list: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.format.list.label', 'List rhythm'),
      description: tOr(t || fallbackTranslator, 'app.facelessReel.format.list.description', 'Three distinct visual beats with room for captions added later.'),
      direction: tOr(t || fallbackTranslator, 'app.facelessReel.format.list.direction', 'Create three readable visual beats without rendering numbers, captions or interface text into the video.'),
    },
    'micro-story': {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.format.microStory.label', 'Micro-story'),
      description: tOr(t || fallbackTranslator, 'app.facelessReel.format.microStory.description', 'A compact beginning, turn and ending without a presenter.'),
      direction: tOr(t || fallbackTranslator, 'app.facelessReel.format.microStory.direction', 'Tell a tiny story with an immediate setup, one visual turn and a conclusive final image.'),
    },
    mood: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.format.mood.label', 'Mood reel'),
      description: tOr(t || fallbackTranslator, 'app.facelessReel.format.mood.description', 'Texture, atmosphere and movement led by a consistent visual motif.'),
      direction: tOr(t || fallbackTranslator, 'app.facelessReel.format.mood.direction', 'Build a cohesive atmospheric sequence around one recurring visual motif and controlled transitions.'),
    },
  };
  return formats[id] || formats.explainer;
}

export function facelessReelPacingCopy(t, id) {
  const pacing = {
    measured: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.pacing.measured.label', 'Measured'),
      direction: tOr(t || fallbackTranslator, 'app.facelessReel.pacing.measured.direction', 'Use calm, deliberate motion and hold the final composition long enough to read.'),
    },
    balanced: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.pacing.balanced.label', 'Balanced'),
      direction: tOr(t || fallbackTranslator, 'app.facelessReel.pacing.balanced.direction', 'Use a clear opening hook, purposeful middle beat and stable finish.'),
    },
    fast: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.pacing.fast.label', 'Fast'),
      direction: tOr(t || fallbackTranslator, 'app.facelessReel.pacing.fast.direction', 'Use energetic but readable motion, decisive transitions and no strobing.'),
    },
  };
  return pacing[id] || pacing.balanced;
}

export function facelessReelPlatformCopy(t, id) {
  const labels = {
    reels: tOr(t || fallbackTranslator, 'app.facelessReel.platform.reels', 'Reels / TikTok'),
    shorts: tOr(t || fallbackTranslator, 'app.facelessReel.platform.shorts', 'YouTube Shorts'),
    web: tOr(t || fallbackTranslator, 'app.facelessReel.platform.web', 'Web / YouTube'),
  };
  return labels[id] || labels.reels;
}

function pick(options, id) {
  return options.find((option) => option.id === id) || options[0];
}

export function facelessReelValidation(values, t) {
  const topic = String(values?.topic || '').trim();
  const hook = String(values?.hook || '').trim();
  if (topic.length < 20) return copy(t, 'app.facelessReel.error.topicShort', 'Describe the idea in at least 20 characters so the visual story has enough direction.');
  if (topic.length > 800) return copy(t, 'app.facelessReel.error.topicLong', 'Keep the visual brief to 800 characters or fewer.');
  if (hook.length > 160) return copy(t, 'app.facelessReel.error.hookLong', 'Keep the optional hook to 160 characters or fewer.');
  if (![5, 10].includes(Number(values?.duration))) return copy(t, 'app.facelessReel.error.duration', 'Choose a supported 5- or 10-second render.');
  if (values?.sound && Number(values?.duration) > 8) return copy(t, 'app.facelessReel.error.soundDuration', 'Generated sound is available only for the 5-second reel. Choose 5 seconds or finish the longer clip separately.');
  if (!values?.originality || !values?.faceless) return copy(t, 'app.facelessReel.error.review', 'Confirm the originality and faceless-media review before continuing.');
  return null;
}

export function buildFacelessReelPrompt(values, t) {
  const format = pick(FACELESS_REEL_FORMATS, values?.format);
  const pacing = pick(FACELESS_REEL_PACING, values?.pacing);
  const platform = pick(FACELESS_REEL_PLATFORMS, values?.platform);
  const formatCopy = facelessReelFormatCopy(t, format.id);
  const pacingCopy = facelessReelPacingCopy(t, pacing.id);
  const platformLabel = facelessReelPlatformCopy(t, platform.id);
  const topic = String(values?.topic || '').trim().replace(/[.!?]+$/, '');
  const hook = String(values?.hook || '').trim().replace(/[.!?]+$/, '');
  const duration = Number(values?.duration) === 10 ? 10 : 5;
  return [
    copy(t, 'app.facelessReel.prompt.open', 'Create an original {duration}-second faceless short-form video about: {topic}.').replace('{duration}', duration).replace('{topic}', topic),
    hook
      ? copy(t, 'app.facelessReel.prompt.hook', 'Editorial hook for later captioning: {hook}. Do not render the words into the generated video.').replace('{hook}', hook)
      : copy(t, 'app.facelessReel.prompt.noHook', 'Open with an immediate visual hook that needs no presenter or baked-in text.'),
    copy(t, 'app.facelessReel.prompt.structure', 'Structure: {label}. {direction}').replace('{label}', formatCopy.label).replace('{direction}', formatCopy.direction),
    copy(t, 'app.facelessReel.prompt.pacing', 'Pacing: {label}. {direction}').replace('{label}', pacingCopy.label).replace('{direction}', pacingCopy.direction),
    copy(t, 'app.facelessReel.prompt.delivery', 'Delivery: {label}, {aspect}. Keep the main action inside mobile-safe framing and reserve uncluttered lower-third space for captions added during finishing.').replace('{label}', platformLabel).replace('{aspect}', platform.aspect),
    copy(t, 'app.facelessReel.prompt.people', 'Use original environments, objects, graphics and non-identifying human details only when useful. Do not show an identifiable face, a speaking presenter, a celebrity likeness, copied creator styling, private information, platform interface, logos or watermarks.'),
    copy(t, 'app.facelessReel.prompt.continuity', 'Keep continuity, lighting and the central visual motif stable. Avoid illegible generated text, subtitles, title cards and unsupported factual claims.'),
    copy(t, 'app.facelessReel.prompt.silent', 'Deliver a silent visual master. Narration, music, sound design, captions and publishing are separate reviewed steps.'),
  ].join(' ');
}

export function facelessReelLaunch(values, t) {
  const platform = pick(FACELESS_REEL_PLATFORMS, values?.platform);
  return {
    model: FACELESS_REEL_MODEL,
    prompt: buildFacelessReelPrompt(values, t),
    aspect: platform.aspect,
    durationSeconds: Number(values?.duration) === 10 ? 10 : 5,
    ...(values?.sound ? { followup: 'generated-sound' } : {}),
  };
}
