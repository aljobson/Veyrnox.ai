import { TTS_VOICES } from './textToSpeech.js';
import { CREATOR_SCENARIOS, PRESENTER_SCENARIOS } from './identityStudio.js';

export const AVATAR_PROFILE_KEY = 'veyrnox_avatar_profiles_v1';
export const AVATAR_PROFILE_LIMIT = 20;

export const AVATAR_SCENARIOS = Object.freeze([
  { id: 'professional', label: 'Professional', brief: 'polished studio presenter, smart contemporary wardrobe, calm direct eye contact, restrained office background' },
  { id: 'social', label: 'Social media', brief: 'approachable creator portrait, contemporary casual styling, warm natural light, uncluttered vertical composition' },
  { id: 'lifestyle', label: 'Lifestyle', brief: 'relaxed editorial portrait in a believable everyday setting, natural posture, soft environmental light' },
  { id: 'fitness', label: 'Fitness', brief: 'confident adult fitness presenter, practical activewear, bright training environment, energetic but natural stance' },
  { id: 'course', label: 'Online course', brief: 'friendly adult instructor, smart casual clothing, warm study background, clear and encouraging expression' },
]);

export const ALL_AVATAR_SCENARIOS = Object.freeze([
  ...AVATAR_SCENARIOS,
  ...PRESENTER_SCENARIOS,
  ...CREATOR_SCENARIOS,
]);

const VALID_SOURCE_MODES = new Set(['prompt', 'photo']);
const VOICE_IDS = new Set(TTS_VOICES.map((voice) => voice.id));
const JOB_ID = /^[A-Za-z0-9_-]{8,128}$/;

function cleanText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function cleanLook(look, fallbackTime) {
  if (!look || typeof look !== 'object') return null;
  const savedAt = Number.isFinite(Number(look.savedAt)) ? Number(look.savedAt) : fallbackTime;
  const appearance = cleanText(look.appearance, 900);
  if (!appearance) return null;
  const assetJobId = cleanText(look.assetJobId, 128);
  return {
    id: cleanText(look.id, 80) || `look-${savedAt}`,
    label: cleanText(look.label, 60) || 'Primary look',
    appearance,
    scenarioId: ALL_AVATAR_SCENARIOS.some((scenario) => scenario.id === look.scenarioId) ? look.scenarioId : AVATAR_SCENARIOS[0].id,
    assetJobId: JOB_ID.test(assetJobId) ? assetJobId : null,
    savedAt,
  };
}

function cleanProfile(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const savedAt = Number(profile.savedAt);
  if (!Number.isFinite(savedAt)) return null;
  const looks = (Array.isArray(profile.looks) ? profile.looks : [])
    .map((look) => cleanLook(look, savedAt))
    .filter(Boolean)
    .slice(-12);
  if (!looks.length) return null;
  return {
    id: cleanText(profile.id, 80) || `avatar-${savedAt}`,
    name: cleanText(profile.name, 60) || 'Untitled avatar',
    role: cleanText(profile.role, 160),
    canon: cleanText(profile.canon, 700),
    sourceMode: VALID_SOURCE_MODES.has(profile.sourceMode) ? profile.sourceMode : 'prompt',
    rightsBasis: profile.sourceMode === 'photo' ? 'consented-adult' : 'synthetic-original',
    voiceId: VOICE_IDS.has(profile.voiceId) ? profile.voiceId : TTS_VOICES[0].id,
    disclosure: profile.disclosure !== false,
    looks,
    savedAt,
    updatedAt: Number.isFinite(Number(profile.updatedAt)) ? Number(profile.updatedAt) : savedAt,
  };
}

export function readAvatarProfiles(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(AVATAR_PROFILE_KEY));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(cleanProfile).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, AVATAR_PROFILE_LIMIT);
  } catch {
    return [];
  }
}

export function buildAvatarPrompt({ sourceMode = 'prompt', appearance = '', canon = '', role = '', scenarioId = 'professional' } = {}) {
  const scenario = ALL_AVATAR_SCENARIOS.find((item) => item.id === scenarioId) || AVATAR_SCENARIOS[0];
  const identityBoundary = sourceMode === 'photo'
    ? 'Use the permitted adult reference as the identity anchor. Preserve facial structure, age cues, skin tone and recognisable features.'
    : 'Create one original fictional adult who does not resemble a real person or public figure.';
  return [
    identityBoundary,
    cleanText(appearance, 900),
    cleanText(canon, 700) ? `Identity canon that must not drift: ${cleanText(canon, 700)}.` : '',
    cleanText(role, 160) ? `Recurring role: ${cleanText(role, 160)}.` : '',
    `First look: ${scenario.brief}.`,
    'Single adult subject, clear unobstructed face and mouth, consistent proportions, no text, watermark or logo.',
  ].filter(Boolean).join(' ');
}

export function saveAvatarProfile(storage, input, now = Date.now(), random = Math.random) {
  try {
    const current = readAvatarProfiles(storage);
    const sourceMode = VALID_SOURCE_MODES.has(input?.sourceMode) ? input.sourceMode : 'prompt';
    const appearance = cleanText(input?.appearance, 900);
    if (!appearance) return { ok: false, code: 'appearance_required', item: null, items: current };
    if (sourceMode === 'photo' && input?.photoReady !== true) return { ok: false, code: 'source_required', item: null, items: current };
    if (sourceMode === 'photo' && input?.rightsConfirmed !== true) return { ok: false, code: 'rights_required', item: null, items: current };
    if (input?.disclosure !== true) return { ok: false, code: 'disclosure_required', item: null, items: current };

    const id = cleanText(input?.id, 80) || `avatar-${now}-${Math.max(0, random()).toString(36).slice(2, 8)}`;
    const previous = current.find((profile) => profile.id === id) || null;
    const look = cleanLook({
      id: `look-${now}-${Math.max(0, random()).toString(36).slice(2, 8)}`,
      label: input?.lookLabel,
      appearance,
      scenarioId: input?.scenarioId,
      savedAt: now,
    }, now);
    const item = cleanProfile({
      id,
      name: input?.name,
      role: input?.role,
      canon: input?.canon,
      sourceMode,
      voiceId: input?.voiceId,
      disclosure: true,
      looks: [...(previous?.looks || []), look],
      savedAt: previous?.savedAt || now,
      updatedAt: now,
    });
    const items = [item, ...current.filter((profile) => profile.id !== id)].slice(0, AVATAR_PROFILE_LIMIT);
    storage.setItem(AVATAR_PROFILE_KEY, JSON.stringify(items));
    return { ok: true, code: null, item, items };
  } catch {
    return { ok: false, code: 'storage_unavailable', item: null, items: [] };
  }
}

export function avatarProfileById(storage, id) {
  return readAvatarProfiles(storage).find((profile) => profile.id === id) || null;
}

export function bindAvatarPortrait(storage, { profileId, jobId, lookId } = {}, now = Date.now()) {
  const profiles = readAvatarProfiles(storage);
  const cleanProfileId = cleanText(profileId, 80);
  const cleanJobId = cleanText(jobId, 128);
  if (!cleanProfileId || !JOB_ID.test(cleanJobId)) return { ok: false, code: 'invalid_binding', item: null, items: profiles };
  const index = profiles.findIndex((profile) => profile.id === cleanProfileId);
  if (index < 0) return { ok: false, code: 'profile_missing', item: null, items: profiles };
  const profile = profiles[index];
  const requestedLookId = cleanText(lookId, 80);
  const targetIndex = requestedLookId
    ? profile.looks.findIndex((look) => look.id === requestedLookId)
    : profile.looks.length - 1;
  if (targetIndex < 0) return { ok: false, code: 'look_missing', item: null, items: profiles };
  const looks = profile.looks.map((look, lookIndex) => lookIndex === targetIndex ? { ...look, assetJobId: cleanJobId } : look);
  const item = cleanProfile({ ...profile, looks, updatedAt: now });
  const items = [item, ...profiles.filter((entry) => entry.id !== item.id)].slice(0, AVATAR_PROFILE_LIMIT);
  try {
    storage.setItem(AVATAR_PROFILE_KEY, JSON.stringify(items));
    return { ok: true, code: null, item, items };
  } catch {
    return { ok: false, code: 'storage_unavailable', item: null, items: profiles };
  }
}
