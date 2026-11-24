export const AUDIO_QUEUE_KEY = 'veyrnox_audio_queue_v2';
export const LEGACY_MUSIC_QUEUE_KEY = 'veyrnox_music_queue_v1';
export const AUDIO_QUEUE_VERSION = 2;
export const WEB_AUDIO_QUEUE_MAX = 50;

const PUBLIC_SLUG = /^[a-f0-9]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OWNED_SOURCES = new Set(['music', 'speech', 'dialogue', 'audio_shelf']);
const PUBLIC_KEYS = new Set(['type', 'slug', 'title', 'display_name']);
const OWNED_KEYS = new Set(['type', 'job_id', 'title', 'source', 'song_id']);

const bounded = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const exactKeys = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));

export function cleanAudioQueueEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.type === 'public_slug') {
    if (!exactKeys(value, PUBLIC_KEYS) || !PUBLIC_SLUG.test(value.slug || '')) return null;
    const title = bounded(value.title, 120);
    if (!title) return null;
    return { type: 'public_slug', slug: value.slug, title, display_name: bounded(value.display_name, 80) };
  }
  if (value.type === 'owned_asset') {
    if (!exactKeys(value, OWNED_KEYS) || !UUID.test(value.job_id || '') || !OWNED_SOURCES.has(value.source)) return null;
    const title = bounded(value.title, 120);
    if (!title) return null;
    const songId = value.song_id === undefined ? undefined : bounded(value.song_id, 36).toLowerCase();
    if (songId !== undefined && !UUID.test(songId)) return null;
    return { type: 'owned_asset', job_id: value.job_id.toLowerCase(), title, source: value.source, ...(songId ? { song_id: songId } : {}) };
  }
  return null;
}

export function publicAudioQueueEntry(value) {
  return cleanAudioQueueEntry({
    type: 'public_slug', slug: value?.slug, title: value?.title, display_name: value?.display_name,
  });
}

export const audioQueueEntryKey = (entry) => entry.type === 'public_slug' ? `public:${entry.slug}` : `owned:${entry.job_id}`;
export const privateOwnedAssetPath = (entry) => entry?.type === 'owned_asset' && UUID.test(entry.job_id || '') ? `/api/v1/jobs/${entry.job_id}/asset` : null;

export function sanitizeAudioQueue(value, owner = '', max = WEB_AUDIO_QUEUE_MAX) {
  const storedOwner = typeof value?.owner === 'string' ? value.owner : '';
  const rows = value?.version === AUDIO_QUEUE_VERSION && Array.isArray(value.queue) ? value.queue : [];
  const seen = new Set();
  const queue = [];
  for (const raw of rows) {
    const entry = cleanAudioQueueEntry(raw);
    if (!entry || (entry.type === 'owned_asset' && (!owner || storedOwner !== owner))) continue;
    const key = audioQueueEntryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key); queue.push(entry);
    if (queue.length >= max) break;
  }
  const index = Number.isInteger(value?.index) && value.index >= 0 && value.index < queue.length ? value.index : 0;
  return { version: AUDIO_QUEUE_VERSION, owner: queue.some((row) => row.type === 'owned_asset') ? owner : '', queue, index };
}

function legacyPublicEnvelope(sessionStorage) {
  try {
    const parsed = JSON.parse(sessionStorage?.getItem(LEGACY_MUSIC_QUEUE_KEY) || 'null');
    const queue = Array.isArray(parsed?.queue) ? parsed.queue.map((row) => cleanAudioQueueEntry({
      type: 'public_slug', slug: row?.slug, title: row?.title, display_name: row?.display_name,
    })).filter(Boolean).slice(0, WEB_AUDIO_QUEUE_MAX) : [];
    const index = Number.isInteger(parsed?.index) && parsed.index >= 0 && parsed.index < queue.length ? parsed.index : 0;
    return { version: AUDIO_QUEUE_VERSION, owner: '', queue, index };
  } catch { return { version: AUDIO_QUEUE_VERSION, owner: '', queue: [], index: 0 }; }
}

export function readAudioQueue(localStorage, sessionStorage, owner = '') {
  try {
    const raw = localStorage?.getItem(AUDIO_QUEUE_KEY);
    if (raw !== null && raw !== undefined) return sanitizeAudioQueue(JSON.parse(raw), owner);
  } catch { return sanitizeAudioQueue(null, owner); }
  const migrated = legacyPublicEnvelope(sessionStorage);
  try {
    localStorage?.setItem(AUDIO_QUEUE_KEY, JSON.stringify(migrated));
    sessionStorage?.removeItem(LEGACY_MUSIC_QUEUE_KEY);
  } catch { /* keep the legacy value so migration can retry */ }
  return migrated;
}

export function writeAudioQueue(localStorage, owner, value) {
  if ((value?.queue || []).some((entry) => entry?.type === 'owned_asset') && value?.owner !== owner) return false;
  const sanitized = sanitizeAudioQueue({ ...value, version: AUDIO_QUEUE_VERSION, owner }, owner);
  if (sanitized.queue.some((entry) => entry.type === 'owned_asset') && !owner) return false;
  try { localStorage?.setItem(AUDIO_QUEUE_KEY, JSON.stringify(sanitized)); return true; }
  catch { return false; }
}

export function withoutOwnedAudio(value) {
  const queue = (value?.queue || []).filter((entry) => entry?.type === 'public_slug');
  return sanitizeAudioQueue({ version: AUDIO_QUEUE_VERSION, owner: '', queue, index: Math.min(value?.index || 0, Math.max(0, queue.length - 1)) }, '');
}

export function permittedAudioQueue(value, { publicEnabled, ownedEnabled, owner }) {
  const queue = (value?.queue || []).filter((entry) => entry?.type === 'public_slug'
    ? publicEnabled : ownedEnabled && Boolean(owner) && value?.owner === owner);
  return sanitizeAudioQueue({ version: AUDIO_QUEUE_VERSION, owner: value?.owner || '', queue,
    index: Math.min(value?.index || 0, Math.max(0, queue.length - 1)) }, owner || '');
}

export const canPersistAudioQueue = (loaded, publicEnabled, ownedEnabled) => loaded === true && (publicEnabled || ownedEnabled);
