const DAY_MS = 24 * 60 * 60 * 1000;
const ID = /^v1:(\d{4}-\d{2}-\d{2}):([a-z0-9]+(?:-[a-z0-9]+)*)$/;

export const MUSIC_DAILY_CHALLENGE_VERSION = 'v1';

// Appending, removing or reordering descriptors changes the day-to-key mapping and requires a catalog-version bump.
export const MUSIC_DAILY_CHALLENGE_DESCRIPTORS = Object.freeze([
  'glass-after-rain',
  'one-room-orchestra',
  'midnight-machines',
  'paper-satellites',
  'velvet-steps',
  'gravity-in-reverse',
  'copper-sunrise',
]);

function instant(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('invalid_challenge_instant');
  return date;
}

function utcDate(date) {
  return date.toISOString().slice(0, 10);
}

/** Deterministic, reward-free prompt for the UTC day. No user or provider data is read. */
export function musicDailyChallengeAt(now = Date.now()) {
  const date = instant(now);
  const day = utcDate(date);
  const start = Date.parse(`${day}T00:00:00.000Z`);
  const index = ((Math.floor(start / DAY_MS) % MUSIC_DAILY_CHALLENGE_DESCRIPTORS.length)
    + MUSIC_DAILY_CHALLENGE_DESCRIPTORS.length) % MUSIC_DAILY_CHALLENGE_DESCRIPTORS.length;
  const key = MUSIC_DAILY_CHALLENGE_DESCRIPTORS[index];
  return Object.freeze({
    catalog_version: MUSIC_DAILY_CHALLENGE_VERSION,
    id: `${MUSIC_DAILY_CHALLENGE_VERSION}:${day}:${key}`,
    date: day,
    reset_at: new Date(start + DAY_MS).toISOString(),
    title_key: `music.dailyChallenge.prompt.${key}.title`,
    prompt_key: `music.dailyChallenge.prompt.${key}.prompt`,
    no_reward: true,
  });
}

/** Resolve only today's exact id; malformed, stale and future links fail closed. */
export function musicDailyChallengeForId(value, now = Date.now()) {
  if (typeof value !== 'string' || !ID.test(value)) return null;
  const current = musicDailyChallengeAt(now);
  return value === current.id ? current : null;
}
