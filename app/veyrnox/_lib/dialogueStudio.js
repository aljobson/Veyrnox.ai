import { DIALOGUE_VOICES, parseDialogue } from '../../../lib/dialogue.js';

export { DIALOGUE_VOICES };

export const DIALOGUE_MODEL_ID = 'elevenlabs-dialogue';
export const PHOTO_DIALOGUE_MODEL_ID = 'multitalk-dialogue';
export const MAX_DIALOGUE_CHARS = 1000;
export const MAX_DIALOGUE_TURNS = 12;
export const MAX_PHOTO_DIALOGUE_SECONDS = 5;
export const MIN_DIALOGUE_SPEAKERS = 2;
export const MAX_DIALOGUE_SPEAKERS = DIALOGUE_VOICES.length;
export const PHOTO_DIALOGUE_VOICES = Object.freeze([
  'Aria', 'Roger', 'Sarah', 'Laura', 'Charlie', 'George', 'Callum', 'River', 'Liam', 'Charlotte',
  'Alice', 'Matilda', 'Will', 'Jessica', 'Eric', 'Chris', 'Brian', 'Daniel', 'Lily', 'Bill',
]);

export const DIALOGUE_MODES = Object.freeze([
  {
    id: 'audio-script',
    label: 'Dialogue audio',
    eyebrow: 'AVAILABLE',
    description: 'Write ordered turns for two to four speakers and create one reusable stock-voice audio file.',
    status: 'available',
  },
  {
    id: 'photo-dialogue',
    label: 'Two-person photo',
    eyebrow: 'VIDEO · LIVE',
    description: 'Animate two people in one permitted photo from one written contribution each.',
    status: 'available',
  },
  {
    id: 'video-dialogue',
    label: 'Two-person video',
    eyebrow: 'REDUB · PLANNED',
    description: 'Replace dialogue in an existing two-person clip while preserving its visual performance.',
    status: 'planned',
  },
]);

export function validatePhotoDialogueTurns(turns) {
  const base = validateDialogueTurns(turns);
  const errors = [...base.errors];
  if ((Array.isArray(turns) ? turns : []).length !== 2) errors.push('Photo dialogue needs exactly two speaker turns.');
  if (base.speakers.length !== 2) errors.push('Photo dialogue needs exactly two different speakers.');
  const clean = (Array.isArray(turns) ? turns : []).map((turn) => String(turn?.text || '').trim());
  if (clean.some((text) => text.length > MAX_DIALOGUE_CHARS)) errors.push(`Keep each speaker to ${MAX_DIALOGUE_CHARS} characters.`);
  const seconds = estimatedDialogueSeconds(turns);
  if (seconds > MAX_PHOTO_DIALOGUE_SECONDS) errors.push(`Shorten the combined speech to about ${MAX_PHOTO_DIALOGUE_SECONDS} seconds.`);
  return {
    ...base,
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    firstText: clean[0] || '',
    secondText: clean[1] || '',
    seconds,
  };
}

const SPEAKER_NAME = /^[\p{L}][\p{L}\p{N} .'-]{0,29}$/u;

export function compileDialogueTurns(turns) {
  return (Array.isArray(turns) ? turns : [])
    .map((turn) => ({
      speaker: String(turn?.speaker || '').trim(),
      text: String(turn?.text || '').trim(),
    }))
    .filter((turn) => turn.speaker || turn.text)
    .map((turn) => `${turn.speaker}: ${turn.text}`)
    .join('\n');
}

export function dialogueVoiceAssignments(turns) {
  const names = [];
  for (const turn of Array.isArray(turns) ? turns : []) {
    const name = String(turn?.speaker || '').trim();
    if (name && !names.some((known) => known.toLowerCase() === name.toLowerCase())) names.push(name);
  }
  return names.map((speaker, index) => ({ speaker, voice: DIALOGUE_VOICES[index] || null }));
}

export function moveDialogueTurn(turns, index, direction) {
  const list = Array.isArray(turns) ? turns : [];
  if (!Number.isInteger(index) || ![-1, 1].includes(direction)) return list;
  const target = index + direction;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const reordered = [...list];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered;
}

export function validateDialogueTurns(turns) {
  const list = Array.isArray(turns) ? turns : [];
  const script = compileDialogueTurns(list);
  const errors = [];
  if (list.length < 2) errors.push('Add at least two turns.');
  if (list.length > MAX_DIALOGUE_TURNS) errors.push(`Use no more than ${MAX_DIALOGUE_TURNS} turns.`);
  for (const [index, turn] of list.entries()) {
    const speaker = String(turn?.speaker || '').trim();
    const text = String(turn?.text || '').trim();
    if (!SPEAKER_NAME.test(speaker)) errors.push(`Turn ${index + 1} needs a speaker name of 1–30 letters or numbers.`);
    if (!text) errors.push(`Turn ${index + 1} needs dialogue.`);
  }
  const speakers = dialogueVoiceAssignments(list);
  if (speakers.length < MIN_DIALOGUE_SPEAKERS) errors.push('Use at least two different speakers.');
  if (speakers.length > MAX_DIALOGUE_SPEAKERS) errors.push(`Use no more than ${MAX_DIALOGUE_SPEAKERS} speakers.`);
  if (script.length > MAX_DIALOGUE_CHARS) errors.push(`Shorten the script to ${MAX_DIALOGUE_CHARS} characters.`);
  if (script && !parseDialogue(script).ok) errors.push('The speaker order could not be prepared.');
  return { ok: errors.length === 0, errors: [...new Set(errors)], script, characters: script.length, speakers };
}

export function estimatedDialogueSeconds(turns, wordsPerSecond = 2.35) {
  const words = (Array.isArray(turns) ? turns : [])
    .flatMap((turn) => String(turn?.text || '').trim().split(/\s+/))
    .filter(Boolean).length;
  return words ? Math.max(1, Math.ceil(words / wordsPerSecond)) : 0;
}
