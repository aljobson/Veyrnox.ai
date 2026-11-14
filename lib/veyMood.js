// Vey's moods: a face and a small prop that say how the product is doing, kept apart from the body pose
// (idle, walking, pointing...). One name per app situation; `veyMoodFor` is the single place that maps
// a situation to a mood, so call sites never pick a face by hand.

export const VEY_MOODS = ['happy', 'patient', 'sorry', 'broke', 'curious', 'welcome', 'playful', 'sleepy', 'firm'];

const SITUATION_MOOD = {
  'generation-succeeded': 'happy',
  'generation-running': 'patient',
  'generation-failed': 'sorry',
  'out-of-credits': 'broke',
  'empty-library': 'curious',
  'first-sign-in': 'welcome',
  'checkin-claimed': 'playful',
  offline: 'sleepy',
  'prompt-blocked': 'firm',
};

// The body pose each mood moves in. The face says how Vey feels; the arms say it too. Only an idle or listening
// Vey takes the mood's pose, so walking and pointing are never interrupted.
export const VEY_MOOD_POSE = {
  happy: 'cheer', patient: 'wait', sorry: 'worried', broke: 'worried', curious: 'shrug',
  welcome: 'wave', playful: 'play', sleepy: 'droop', firm: 'firm',
};

export function veyPoseFor(pose, mood) {
  return (pose === 'idle' || pose === 'listening') && VEY_MOOD_POSE[mood] ? VEY_MOOD_POSE[mood] : pose;
}

export const VEY_SITUATIONS = Object.keys(SITUATION_MOOD);

export function isVeyMood(value) {
  return VEY_MOODS.includes(value);
}

// Returns the mood for a situation, or null when the situation is unknown (the face then stays as the pose draws it).
export function veyMoodFor(situation) {
  return SITUATION_MOOD[situation] || null;
}

const MODERATION_CODES = ['provider_moderation', 'content_policy', 'prompt_blocked'];

// Which situation does a Create error code mean? Out of credits and a blocked prompt each get their own face;
// any other refused or failed generation is the apologetic one. Local form mistakes (a missing prompt...)
// are not Vey's to react to, so they return null.
export function veyErrorSituation(code, { refunded = false } = {}) {
  if (code === 'insufficient_balance') return 'out-of-credits';
  if (MODERATION_CODES.includes(code)) return 'prompt-blocked';
  if (refunded || /^provider_|_failed$/.test(String(code || ''))) return 'generation-failed';
  return null;
}

// A situation lasts a while, then Vey settles. Long-running ones (running, offline) are held by their owner instead.
export const VEY_MOOD_HOLD_MS = 6000;

export const VEY_MOOD_EVENT = 'vey:mood';

// Call from anywhere in the browser: `signalVeyMood('generation-failed')`. The helper listens and shows the face.
export function signalVeyMood(situation, holdMs = VEY_MOOD_HOLD_MS) {
  if (typeof window === 'undefined' || !veyMoodFor(situation)) return;
  window.dispatchEvent(new CustomEvent(VEY_MOOD_EVENT, { detail: { situation, holdMs } }));
}
