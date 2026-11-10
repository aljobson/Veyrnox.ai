import { DIALOGUE_VOICES, DIALOGUE_VOICE_INPUTS } from '../../../lib/dialogue.js';

const KEY = 'veyrnox.dialogue-cast-map.v1';
const MAX_SAVED_CAST = 24;
const SPEAKER_NAME = /^[\p{L}][\p{L}\p{N} .'-]{0,29}$/u;

function cleanSpeaker(value) {
  const speaker = typeof value === 'string' ? value.trim() : '';
  return SPEAKER_NAME.test(speaker) ? speaker : '';
}

export function normalizeDialogueCastMap(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.flatMap((entry) => {
    const speaker = cleanSpeaker(entry?.speaker);
    const voice = DIALOGUE_VOICES.includes(entry?.voice) ? entry.voice : '';
    const key = speaker.toLowerCase();
    if (!speaker || !voice || seen.has(key)) return [];
    seen.add(key);
    return [{ speaker, voice }];
  }).slice(0, MAX_SAVED_CAST);
}

export function readDialogueCastMap(storage) {
  try {
    return normalizeDialogueCastMap(JSON.parse(storage.getItem(KEY) || '[]'));
  } catch {
    return [];
  }
}

export function setDialogueCastVoice(storage, speakerValue, voice) {
  const speaker = cleanSpeaker(speakerValue);
  const current = readDialogueCastMap(storage);
  if (!speaker || !DIALOGUE_VOICES.includes(voice)) return current;
  const key = speaker.toLowerCase();
  const next = [{ speaker, voice }, ...current.filter((entry) => entry.speaker.toLowerCase() !== key)].slice(0, MAX_SAVED_CAST);
  try {
    storage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

export function forgetDialogueCastSpeakers(storage, speakerValues) {
  const names = new Set((Array.isArray(speakerValues) ? speakerValues : []).map(cleanSpeaker).filter(Boolean).map((name) => name.toLowerCase()));
  const current = readDialogueCastMap(storage);
  const next = current.filter((entry) => !names.has(entry.speaker.toLowerCase()));
  try {
    storage.setItem(KEY, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

export function resolveDialogueCastAssignments(speakers, castMap) {
  const names = [];
  for (const value of Array.isArray(speakers) ? speakers : []) {
    const speaker = cleanSpeaker(typeof value === 'string' ? value : value?.speaker);
    if (speaker && !names.some((name) => name.toLowerCase() === speaker.toLowerCase())) names.push(speaker);
  }
  const preferred = new Map(normalizeDialogueCastMap(castMap).map((entry) => [entry.speaker.toLowerCase(), entry.voice]));
  const used = new Set();
  return names.slice(0, DIALOGUE_VOICES.length).map((speaker) => {
    const saved = preferred.get(speaker.toLowerCase());
    const voice = saved && !used.has(saved) ? saved : DIALOGUE_VOICES.find((candidate) => !used.has(candidate));
    used.add(voice);
    return { speaker, voice };
  });
}

export function dialogueCastInputs(assignments) {
  const list = Array.isArray(assignments) ? assignments : [];
  const voices = list.map((entry) => entry?.voice);
  if (!voices.length || voices.length > DIALOGUE_VOICES.length || new Set(voices).size !== voices.length
    || voices.some((voice) => !DIALOGUE_VOICES.includes(voice))) return {};
  return Object.fromEntries(voices.map((voice, index) => [DIALOGUE_VOICE_INPUTS[index], voice]));
}
