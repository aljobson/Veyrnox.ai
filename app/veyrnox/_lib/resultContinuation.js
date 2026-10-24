const VIDEO_SOUND_KEY = 'veyrnox.video-sound-continuation.v1';
const MAX_AGE_MS = 10 * 60 * 1000;
const JOB_ID = /^[A-Za-z0-9_-]{8,128}$/;

export const DEFAULT_FACELESS_REEL_SOUND_PROMPT = 'Natural sound design precisely synchronized to the visible motion and setting. Build a clean, restrained ambience with believable object and environmental sounds. No speech, narration, music, branded sonic logo or exaggerated impact.';

export function normalizeVideoSoundContinuation(value, now = Date.now()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const jobId = typeof value.jobId === 'string' && JOB_ID.test(value.jobId) ? value.jobId : null;
  const assetUrl = typeof value.assetUrl === 'string' && value.assetUrl.startsWith('https://') ? value.assetUrl : null;
  const duration = Number(value.duration);
  const at = Number(value.at);
  if (!jobId || !assetUrl || !Number.isFinite(duration) || duration < 1 || duration > 8) return null;
  if (!Number.isFinite(at) || now - at < 0 || now - at > MAX_AGE_MS) return null;
  return { jobId, assetUrl, duration, prompt: DEFAULT_FACELESS_REEL_SOUND_PROMPT, label: 'Faceless reel result' };
}

export function writeVideoSoundContinuation(storage, value, now = Date.now()) {
  if (!storage) return false;
  const draft = normalizeVideoSoundContinuation({ ...value, at: now }, now);
  if (!draft) return false;
  try {
    storage.setItem(VIDEO_SOUND_KEY, JSON.stringify({ jobId: draft.jobId, assetUrl: draft.assetUrl, duration: draft.duration, at: now }));
    return true;
  } catch {
    return false;
  }
}

export function takeVideoSoundContinuation(storage, now = Date.now()) {
  if (!storage) return null;
  let raw = null;
  try {
    raw = storage.getItem(VIDEO_SOUND_KEY);
    storage.removeItem(VIDEO_SOUND_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return normalizeVideoSoundContinuation(JSON.parse(raw), now);
  } catch {
    return null;
  }
}
