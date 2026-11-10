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

export const BUILTIN_VOICE_PALETTES = Object.freeze([
  {
    id: 'quiet-confidence',
    name: 'Quiet confidence',
    description: 'Measured and grounded for thoughtful narration.',
    settings: Object.freeze({ voice: 'Calm_Woman', emotion: 'neutral', speed: 0.9, volume: 1, pitch: -1, language: 'auto' }),
  },
  {
    id: 'bright-launch',
    name: 'Bright launch',
    description: 'Quick, upbeat delivery for product moments and hooks.',
    settings: Object.freeze({ voice: 'Lively_Girl', emotion: 'happy', speed: 1.1, volume: 2, pitch: 1, language: 'English' }),
  },
  {
    id: 'clear-guide',
    name: 'Clear guide',
    description: 'Even pacing and a steady tone for explainers.',
    settings: Object.freeze({ voice: 'Patient_Man', emotion: 'neutral', speed: 1, volume: 2, pitch: 0, language: 'auto' }),
  },
  {
    id: 'story-depth',
    name: 'Story depth',
    description: 'A slower, lower read for reflective storytelling.',
    settings: Object.freeze({ voice: 'Wise_Woman', emotion: 'neutral', speed: 0.9, volume: 2, pitch: -2, language: 'English' }),
  },
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
