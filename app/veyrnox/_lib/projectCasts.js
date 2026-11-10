import { DIALOGUE_VOICES } from '../../../lib/dialogue.js';

const KEY = 'veyrnox.project-casts.v1';
const MAX_PROJECT_CASTS = 12;
const ID = /^cast-[a-z0-9-]{1,80}$/;
const JOB_ID = /^[A-Za-z0-9_-]{8,128}$/;
const SPEAKER_NAME = /^[\p{L}][\p{L}\p{N} .'-]{0,29}$/u;

function cleanMember(value) {
  const speaker = typeof value?.speaker === 'string' ? value.speaker.trim() : '';
  const voice = DIALOGUE_VOICES.includes(value?.voice) ? value.voice : '';
  if (!SPEAKER_NAME.test(speaker) || !voice) return null;
  const member = { speaker, voice };
  const portraitJobId = typeof value?.portraitJobId === 'string' ? value.portraitJobId.trim() : '';
  if (JOB_ID.test(portraitJobId)) {
    member.portraitJobId = portraitJobId;
    member.portraitLabel = typeof value?.portraitLabel === 'string'
      ? value.portraitLabel.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) || 'Library portrait'
      : 'Library portrait';
  }
  return member;
}

function writeProjectCasts(storage, casts, fallback) {
  try {
    storage.setItem(KEY, JSON.stringify(casts));
    return casts;
  } catch {
    return fallback;
  }
}

export function normalizeProjectCast(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = typeof value.id === 'string' && ID.test(value.id) ? value.id : null;
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 48) : '';
  const candidates = Array.isArray(value.members) ? value.members : [];
  if (candidates.length < 2 || candidates.length > DIALOGUE_VOICES.length) return null;
  const members = [];
  const names = new Set();
  const voices = new Set();
  for (const candidate of candidates) {
    const member = cleanMember(candidate);
    const key = member?.speaker.toLowerCase();
    if (!member || names.has(key) || voices.has(member.voice)) return null;
    names.add(key);
    voices.add(member.voice);
    members.push(member);
  }
  return id && name ? { id, name, members } : null;
}

export function readProjectCasts(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    const ids = new Set();
    return parsed.flatMap((candidate) => {
      const cast = normalizeProjectCast(candidate);
      if (!cast || ids.has(cast.id)) return [];
      ids.add(cast.id);
      return [cast];
    }).slice(0, MAX_PROJECT_CASTS);
  } catch {
    return [];
  }
}

export function saveProjectCast(storage, nameValue, assignments, id = `cast-${Date.now().toString(36)}`) {
  const name = typeof nameValue === 'string' ? nameValue.trim().slice(0, 48) : '';
  const current = readProjectCasts(storage);
  if (!name) return current;
  const matching = current.find((cast) => cast.name.toLowerCase() === name.toLowerCase());
  const members = Array.isArray(assignments) ? assignments.map((assignment) => {
    const previous = matching?.members.find((member) => member.speaker.toLowerCase() === String(assignment?.speaker || '').trim().toLowerCase());
    return previous?.portraitJobId
      ? { ...assignment, portraitJobId: previous.portraitJobId, portraitLabel: previous.portraitLabel }
      : assignment;
  }) : assignments;
  const candidate = normalizeProjectCast({ id: matching?.id || id, name, members });
  if (!candidate) return current;
  const next = [candidate, ...current.filter((cast) => cast.id !== candidate.id)].slice(0, MAX_PROJECT_CASTS);
  return writeProjectCasts(storage, next, current);
}

export function removeProjectCast(storage, castId) {
  const current = readProjectCasts(storage);
  const next = current.filter((cast) => cast.id !== castId);
  return writeProjectCasts(storage, next, current);
}

export function bindProjectCastPortrait(storage, castId, speakerValue, portrait) {
  const current = readProjectCasts(storage);
  const speaker = typeof speakerValue === 'string' ? speakerValue.trim().toLowerCase() : '';
  const jobId = typeof portrait?.id === 'string' ? portrait.id.trim() : '';
  if (!JOB_ID.test(jobId)) return current;
  const index = current.findIndex((cast) => cast.id === castId);
  if (index < 0 || !current[index].members.some((member) => member.speaker.toLowerCase() === speaker)) return current;
  const nextCast = normalizeProjectCast({
    ...current[index],
    members: current[index].members.map((member) => member.speaker.toLowerCase() === speaker
      ? { ...member, portraitJobId: jobId, portraitLabel: portrait.label }
      : member),
  });
  if (!nextCast) return current;
  const next = current.map((cast, castIndex) => castIndex === index ? nextCast : cast);
  return writeProjectCasts(storage, next, current);
}

export function unbindProjectCastPortrait(storage, castId, speakerValue) {
  const current = readProjectCasts(storage);
  const speaker = typeof speakerValue === 'string' ? speakerValue.trim().toLowerCase() : '';
  const index = current.findIndex((cast) => cast.id === castId);
  if (index < 0 || !current[index].members.some((member) => member.speaker.toLowerCase() === speaker && member.portraitJobId)) return current;
  const nextCast = normalizeProjectCast({
    ...current[index],
    members: current[index].members.map((member) => {
      if (member.speaker.toLowerCase() !== speaker) return member;
      return { speaker: member.speaker, voice: member.voice };
    }),
  });
  if (!nextCast) return current;
  const next = current.map((cast, castIndex) => castIndex === index ? nextCast : cast);
  return writeProjectCasts(storage, next, current);
}

export function projectCastTurns(value) {
  const cast = normalizeProjectCast(value);
  return cast ? cast.members.map((member, index) => ({ id: index + 1, speaker: member.speaker, text: '' })) : [];
}
