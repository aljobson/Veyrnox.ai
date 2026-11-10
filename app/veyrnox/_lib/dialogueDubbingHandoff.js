import { DIALOGUE_VOICES, compileDialogueTurns, validateDialogueTurns } from './dialogueStudio.js';

const STORAGE_SLOT = 'veyrnox.dialogue-dubbing-handoff.v1';
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeHandoffCast(value, speakers) {
  if (!Array.isArray(value) || value.length !== speakers.length) return null;
  const voices = new Set();
  const cast = value.map((member, index) => {
    const speaker = typeof member?.speaker === 'string' ? member.speaker.trim() : '';
    const voice = DIALOGUE_VOICES.includes(member?.voice) ? member.voice : '';
    if (speaker.toLowerCase() !== speakers[index].speaker.toLowerCase() || !voice || voices.has(voice)) return null;
    voices.add(voice);
    return { speaker: speakers[index].speaker, voice };
  });
  return cast.every(Boolean) ? cast : null;
}

export function normalizeDialogueDubbingHandoff(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !JOB_ID.test(String(value.jobId || ''))) return null;
  const turns = Array.isArray(value.turns) ? value.turns.map((turn) => ({
    speaker: typeof turn?.speaker === 'string' ? turn.speaker.trim() : '',
    text: typeof turn?.text === 'string' ? turn.text.trim() : '',
  })) : [];
  const validation = validateDialogueTurns(turns);
  if (!validation.ok) return null;
  const cast = normalizeHandoffCast(value.cast, validation.speakers);
  return {
    jobId: String(value.jobId),
    turns,
    speakerCount: validation.speakers.length,
    subtitleScript: compileDialogueTurns(turns),
    ...(cast ? { cast } : {}),
  };
}

export function writeDialogueDubbingHandoff(storage, value) {
  const handoff = normalizeDialogueDubbingHandoff(value);
  if (!storage || !handoff) return false;
  try {
    storage.setItem(STORAGE_SLOT, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

export function readDialogueDubbingHandoff(storage, expectedJobId) {
  if (!storage || !JOB_ID.test(String(expectedJobId || ''))) return null;
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_SLOT);
    storage.removeItem(STORAGE_SLOT);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const handoff = normalizeDialogueDubbingHandoff(JSON.parse(raw));
    return handoff?.jobId === expectedJobId ? handoff : null;
  } catch {
    return null;
  }
}
