import { tOr } from '../../../lib/i18n/translate.mjs';
export const FACELESS_REEL_MODEL = 'wan-2.5-kie';
// Wan 2.5 on Kie has a narrower provider contract than the general media cap.
export const FACELESS_REEL_PROMPT_MAX = 800;

const fallbackTranslator = Object.assign((key) => key, { messages: {} });
const copy = (t, key, fallback, vars) => tOr(t || fallbackTranslator, key, fallback, vars);

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
    },
    list: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.format.list.label', 'List rhythm'),
      description: tOr(t || fallbackTranslator, 'app.facelessReel.format.list.description', 'Three distinct visual beats with room for captions added later.'),
    },
    'micro-story': {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.format.microStory.label', 'Micro-story'),
      description: tOr(t || fallbackTranslator, 'app.facelessReel.format.microStory.description', 'A compact beginning, turn and ending without a presenter.'),
    },
    mood: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.format.mood.label', 'Mood reel'),
      description: tOr(t || fallbackTranslator, 'app.facelessReel.format.mood.description', 'Texture, atmosphere and movement led by a consistent visual motif.'),
    },
  };
  return formats[id] || formats.explainer;
}

export function facelessReelPacingCopy(t, id) {
  const pacing = {
    measured: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.pacing.measured.label', 'Measured'),
    },
    balanced: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.pacing.balanced.label', 'Balanced'),
    },
    fast: {
      label: tOr(t || fallbackTranslator, 'app.facelessReel.pacing.fast.label', 'Fast'),
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
  if (buildFacelessReelPrompt(values).length > FACELESS_REEL_PROMPT_MAX) return copy(t, 'app.facelessReel.error.promptLong', 'Shorten the brief or hook: this model accepts {max} characters in all.', { max: FACELESS_REEL_PROMPT_MAX });
  return null;
}

// Model instructions are English data, matching the phone template verbatim.
const promptFormats = {
  explainer: ['Visual explainer', 'Clear setup, reveal and resolved final frame.'],
  list: ['List rhythm', 'Three clear beats; no numbers, captions or interface text.'],
  'micro-story': ['Micro-story', 'Immediate setup, one turn, conclusive final image.'],
  mood: ['Mood reel', 'Atmosphere, recurring motif, controlled transitions.'],
};
const promptPacing = {
  measured: ['Measured', 'Calm motion; hold the readable final frame.'],
  balanced: ['Balanced', 'Clear hook, purposeful middle, stable finish.'],
  fast: ['Fast', 'Brisk readable motion, decisive cuts; no strobing.'],
};
const platformLabels = { reels: 'Reels / TikTok', shorts: 'YouTube Shorts', web: 'Web / YouTube' };
const clean = (value) => String(value || '').trim().replace(/[.!?]+$/, '');

export function buildFacelessReelPrompt(values) {
  const f = promptFormats[pick(FACELESS_REEL_FORMATS, values?.format).id];
  const p = promptPacing[pick(FACELESS_REEL_PACING, values?.pacing).id];
  const platform = pick(FACELESS_REEL_PLATFORMS, values?.platform);
  const hook = clean(values?.hook);
  return [
    `Original ${Number(values?.duration) === 10 ? 10 : 5}-second faceless short-form video about: ${clean(values?.topic)}.`,
    hook ? `Hook for later captions: ${hook}. Do not render it as text.` : 'Open on an immediate visual hook; no presenter or baked-in text.',
    `Structure: ${f[0]}. ${f[1]}`,
    `Pacing: ${p[0]}. ${p[1]}`,
    `Delivery: ${platformLabels[platform.id]}, ${platform.aspect}; keep action mobile-safe and the lower third clear.`,
    'No identifiable face, presenter, celebrity likeness, copied creator style, private information, platform interface, logos or watermarks.',
    'Stable continuity, lighting and motif; no generated text, subtitles or unsupported claims.',
    'Silent visual master.',
  ].join(' ');
}

export function facelessBriefLength(values) {
  return clean(values?.topic).length;
}

export function facelessBriefRoom(values, max = FACELESS_REEL_PROMPT_MAX) {
  return max - buildFacelessReelPrompt({ ...values, topic: '' }).length;
}

export function facelessReelLaunch(values) {
  const platform = pick(FACELESS_REEL_PLATFORMS, values?.platform);
  return {
    model: FACELESS_REEL_MODEL,
    prompt: buildFacelessReelPrompt(values),
    aspect: platform.aspect,
    durationSeconds: Number(values?.duration) === 10 ? 10 : 5,
    ...(values?.sound ? { followup: 'generated-sound' } : {}),
  };
}
