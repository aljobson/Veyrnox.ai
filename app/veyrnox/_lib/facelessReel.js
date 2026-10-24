export const FACELESS_REEL_MODEL = 'wan-2.5-kie';

export const FACELESS_REEL_FORMATS = Object.freeze([
  { id: 'explainer', label: 'Visual explainer', description: 'One clear idea revealed through objects, places and purposeful motion.', direction: 'Build one visually legible explanation with a clear setup, reveal and resolved final frame.' },
  { id: 'list', label: 'List rhythm', description: 'Three distinct visual beats with room for captions added later.', direction: 'Create three readable visual beats without rendering numbers, captions or interface text into the video.' },
  { id: 'micro-story', label: 'Micro-story', description: 'A compact beginning, turn and ending without a presenter.', direction: 'Tell a tiny story with an immediate setup, one visual turn and a conclusive final image.' },
  { id: 'mood', label: 'Mood reel', description: 'Texture, atmosphere and movement led by a consistent visual motif.', direction: 'Build a cohesive atmospheric sequence around one recurring visual motif and controlled transitions.' },
]);

export const FACELESS_REEL_PACING = Object.freeze([
  { id: 'measured', label: 'Measured', direction: 'Use calm, deliberate motion and hold the final composition long enough to read.' },
  { id: 'balanced', label: 'Balanced', direction: 'Use a clear opening hook, purposeful middle beat and stable finish.' },
  { id: 'fast', label: 'Fast', direction: 'Use energetic but readable motion, decisive transitions and no strobing.' },
]);

export const FACELESS_REEL_PLATFORMS = Object.freeze([
  { id: 'reels', label: 'Reels / TikTok', aspect: '9:16' },
  { id: 'shorts', label: 'YouTube Shorts', aspect: '9:16' },
  { id: 'web', label: 'Web / YouTube', aspect: '16:9' },
]);

function pick(options, id) {
  return options.find((option) => option.id === id) || options[0];
}

export function facelessReelValidation(values) {
  const topic = String(values?.topic || '').trim();
  const hook = String(values?.hook || '').trim();
  if (topic.length < 20) return 'Describe the idea in at least 20 characters so the visual story has enough direction.';
  if (topic.length > 800) return 'Keep the visual brief to 800 characters or fewer.';
  if (hook.length > 160) return 'Keep the optional hook to 160 characters or fewer.';
  if (![5, 10].includes(Number(values?.duration))) return 'Choose a supported 5- or 10-second render.';
  if (values?.sound && Number(values?.duration) > 8) return 'Generated sound is available only for the 5-second reel. Choose 5 seconds or finish the longer clip separately.';
  if (!values?.originality || !values?.faceless) return 'Confirm the originality and faceless-media review before continuing.';
  return null;
}

export function buildFacelessReelPrompt(values) {
  const format = pick(FACELESS_REEL_FORMATS, values?.format);
  const pacing = pick(FACELESS_REEL_PACING, values?.pacing);
  const platform = pick(FACELESS_REEL_PLATFORMS, values?.platform);
  const topic = String(values?.topic || '').trim().replace(/[.!?]+$/, '');
  const hook = String(values?.hook || '').trim().replace(/[.!?]+$/, '');
  const duration = Number(values?.duration) === 10 ? 10 : 5;
  return [
    `Create an original ${duration}-second faceless short-form video about: ${topic}.`,
    hook ? `Editorial hook for later captioning: ${hook}. Do not render the words into the generated video.` : 'Open with an immediate visual hook that needs no presenter or baked-in text.',
    `Structure: ${format.label}. ${format.direction}`,
    `Pacing: ${pacing.label}. ${pacing.direction}`,
    `Delivery: ${platform.label}, ${platform.aspect}. Keep the main action inside mobile-safe framing and reserve uncluttered lower-third space for captions added during finishing.`,
    'Use original environments, objects, graphics and non-identifying human details only when useful. Do not show an identifiable face, a speaking presenter, a celebrity likeness, copied creator styling, private information, platform interface, logos or watermarks.',
    'Keep continuity, lighting and the central visual motif stable. Avoid illegible generated text, subtitles, title cards and unsupported factual claims.',
    'Deliver a silent visual master. Narration, music, sound design, captions and publishing are separate reviewed steps.',
  ].join(' ');
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
