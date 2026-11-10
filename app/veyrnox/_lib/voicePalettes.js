import {
  TTS_EMOTIONS,
  TTS_LANGUAGES,
  TTS_VOICES,
} from './textToSpeech.js';

const STORAGE_SLOT = 'veyrnox.voice-palettes.v1';
const RECIPE_HANDOFF_SLOT = 'veyrnox.voice-recipe-handoff.v1';
const MAX_PERSONAL_PALETTES = 12;
const VOICES = new Set(TTS_VOICES.map((voice) => voice.id));
const EMOTIONS = new Set(TTS_EMOTIONS);
const LANGUAGES = new Set(TTS_LANGUAGES);

export const VOICE_PALETTE_CATEGORIES = Object.freeze(['Narration', 'Marketing', 'Explainers', 'Characters', 'Service']);

// Delivery presets only: a supported stock voice plus emotion, speed, volume, pitch and
// language. No script, no audio, no cloned or real-person voice. Applying one spends nothing.
const palette = (category, id, name, description, voice, emotion, speed, pitch, volume = 2, language = 'auto') => Object.freeze({
  id, name, description, category,
  settings: Object.freeze({ voice, emotion, speed, volume, pitch, language }),
});

export const BUILTIN_VOICE_PALETTES = Object.freeze([
  palette('Narration', 'quiet-confidence', 'Quiet confidence', 'Measured and grounded for thoughtful narration.', 'Calm_Woman', 'neutral', 0.9, -1, 1),
  palette('Narration', 'story-depth', 'Story depth', 'A slower, lower read for reflective storytelling.', 'Wise_Woman', 'neutral', 0.9, -2, 2, 'English'),
  palette('Narration', 'audiobook-warm', 'Audiobook warm', 'Unhurried and intimate for long-form fiction.', 'Abbess', 'neutral', 0.9, -1),
  palette('Narration', 'documentary-gravitas', 'Documentary gravitas', 'Deep, steady and serious for nature and history.', 'Deep_Voice_Man', 'neutral', 0.9, -2),
  palette('Narration', 'bedtime-hush', 'Bedtime hush', 'Slow and soft to wind a story down.', 'Lovely_Girl', 'neutral', 0.8, -1, 1),
  palette('Marketing', 'bright-launch', 'Bright launch', 'Quick, upbeat delivery for product moments and hooks.', 'Lively_Girl', 'happy', 1.1, 1, 2, 'English'),
  palette('Marketing', 'polished-product', 'Polished product', 'Smooth and premium for ad reads.', 'Elegant_Man', 'neutral', 1, 0),
  palette('Marketing', 'scroll-stopper', 'Scroll stopper', 'Fast and punchy for short social hooks.', 'Exuberant_Girl', 'happy', 1.2, 1, 3),
  palette('Marketing', 'trailer-voice', 'Trailer voice', 'Low and commanding for dramatic reveals.', 'Imposing_Manner', 'neutral', 0.8, -3, 3),
  palette('Explainers', 'clear-guide', 'Clear guide', 'Even pacing and a steady tone for explainers.', 'Patient_Man', 'neutral', 1, 0),
  palette('Explainers', 'friendly-tutorial', 'Friendly tutorial', 'Warm and approachable for step-by-step walkthroughs.', 'Friendly_Person', 'neutral', 1, 0),
  palette('Explainers', 'podcast-host', 'Podcast host', 'Relaxed and conversational, slightly brisk.', 'Casual_Guy', 'happy', 1.1, 0),
  palette('Explainers', 'news-desk', 'News desk', 'Crisp, even and neutral for bulletins.', 'Patient_Man', 'neutral', 1.1, 0, 3),
  palette('Characters', 'young-hero', 'Young hero', 'Confident and earnest for adventure characters.', 'Young_Knight', 'neutral', 1, 1),
  palette('Characters', 'storybook-sparkle', 'Storybook sparkle', 'Bright and curious for children’s tales.', 'Sweet_Girl_2', 'happy', 1, 2),
  palette('Characters', 'wise-mentor', 'Wise mentor', 'Slow, low and knowing for guides and elders.', 'Wise_Woman', 'neutral', 0.9, -1),
  palette('Characters', 'shadow-menace', 'Shadow menace', 'Slow and deep for a quiet antagonist.', 'Imposing_Manner', 'neutral', 0.8, -4),
  palette('Service', 'hold-line', 'Hold line', 'Calm and reassuring for phone menus and hold messages.', 'Calm_Woman', 'neutral', 0.9, 0),
  palette('Service', 'steady-announcer', 'Steady announcer', 'Firm and clear for public announcements.', 'Determined_Man', 'neutral', 1, 0, 3),
  palette('Service', 'guided-calm', 'Guided calm', 'Very slow and low for meditation and breathing guides.', 'Abbess', 'neutral', 0.8, -2, 1),
]);

const stepped = (value, min, max, step) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) return null;
  const units = Math.round((number - min) / step);
  return Math.abs(min + units * step - number) < 1e-8 ? number : null;
};

export function normalizeVoicePaletteSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const voice = VOICES.has(value.voice) ? value.voice : null;
  const emotion = EMOTIONS.has(value.emotion) ? value.emotion : null;
  const language = LANGUAGES.has(value.language) ? value.language : null;
  const speed = stepped(value.speed, 0.5, 2, 0.1);
  const volume = stepped(value.volume, 0, 10, 1);
  const pitch = stepped(value.pitch, -12, 12, 1);
  if (!voice || !emotion || !language || speed === null || volume === null || pitch === null) return null;
  return { voice, emotion, speed, volume, pitch, language };
}

export function voiceRecipeSummary(value) {
  const settings = normalizeVoicePaletteSettings(value);
  if (!settings) return '';
  const voice = TTS_VOICES.find((item) => item.id === settings.voice);
  return `${voice?.label || 'Stock voice'} · ${settings.emotion} · ${settings.speed}×`;
}

export function voiceRecipesMatch(left, right) {
  const first = normalizeVoicePaletteSettings(left);
  const second = normalizeVoicePaletteSettings(right);
  if (!first || !second) return false;
  return ['voice', 'emotion', 'speed', 'volume', 'pitch', 'language']
    .every((key) => first[key] === second[key]);
}

export function stageVoiceRecipeHandoff(storage, accountId, name, value) {
  const settings = normalizeVoicePaletteSettings(value);
  const owner = typeof accountId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(accountId) ? accountId : '';
  const label = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64) : '';
  if (!storage || !owner || !label || !settings) return false;
  try {
    storage.setItem(RECIPE_HANDOFF_SLOT, JSON.stringify({ owner, label, settings }));
    return true;
  } catch {
    return false;
  }
}

export function consumeVoiceRecipeHandoff(storage, accountId) {
  if (!storage) return null;
  let parsed;
  try {
    parsed = JSON.parse(storage.getItem(RECIPE_HANDOFF_SLOT) || 'null');
    storage.removeItem(RECIPE_HANDOFF_SLOT);
  } catch {
    try { storage.removeItem(RECIPE_HANDOFF_SLOT); } catch { /* invalid handoff is discarded */ }
    return null;
  }
  const owner = typeof accountId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(accountId) ? accountId : '';
  const label = typeof parsed?.label === 'string' ? parsed.label.trim().slice(0, 64) : '';
  const settings = normalizeVoicePaletteSettings(parsed?.settings);
  return owner && parsed?.owner === owner && label && settings ? { label, settings } : null;
}

function normalizePersonalPalette(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = typeof value.id === 'string' && /^personal-[a-z0-9-]{1,80}$/.test(value.id) ? value.id : null;
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 40) : '';
  const settings = normalizeVoicePaletteSettings(value.settings);
  return id && name && settings ? { id, name, settings } : null;
}

export function readVoicePalettes(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_SLOT) || '[]');
    if (!Array.isArray(parsed)) return [];
    const seen = new Set();
    return parsed.flatMap((value) => {
      const palette = normalizePersonalPalette(value);
      if (!palette || seen.has(palette.id)) return [];
      seen.add(palette.id);
      return [palette];
    }).slice(0, MAX_PERSONAL_PALETTES);
  } catch {
    return [];
  }
}

export function saveVoicePalette(storage, name, settings, id = `personal-${Date.now().toString(36)}`) {
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 40) : '';
  const cleanSettings = normalizeVoicePaletteSettings(settings);
  if (!cleanName || !cleanSettings) return readVoicePalettes(storage);
  const current = readVoicePalettes(storage);
  const matching = current.find((palette) => palette.name.toLowerCase() === cleanName.toLowerCase());
  const candidate = normalizePersonalPalette({ id: matching?.id || id, name: cleanName, settings: cleanSettings });
  if (!candidate) return current;
  const next = [candidate, ...current.filter((palette) => palette.id !== candidate.id)].slice(0, MAX_PERSONAL_PALETTES);
  try {
    storage.setItem(STORAGE_SLOT, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

export function removeVoicePalette(storage, paletteId) {
  const current = readVoicePalettes(storage);
  const next = current.filter((palette) => palette.id !== paletteId);
  try {
    storage.setItem(STORAGE_SLOT, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}
