import { getMusicDiscoverSeed, normalizeMusicSampleMix } from '../../../../lib/musicDiscover.js';

const PREFIX = 'veyrnox.music.saved-mixes.v1:';
const OWNER = /^[A-Za-z0-9._-]{1,128}$/;
const MIX_ID = /^mix-[A-Za-z0-9-]{8,80}$/;
export const MUSIC_SAVED_MIXES_CHANGED = 'veyrnox:music-saved-mixes-changed';
export const MAX_MUSIC_SAVED_MIXES = 100;

const keyFor = (ownerId) => typeof ownerId === 'string' && OWNER.test(ownerId)
  ? `${PREFIX}${ownerId}`
  : null;

function cleanName(value) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64)
    : '';
}

export function isMusicSavedMixId(value) {
  return typeof value === 'string' && MIX_ID.test(value);
}

export function normalizeMusicSavedMix(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = isMusicSavedMixId(value.id) ? value.id : '';
  const beat = getMusicDiscoverSeed(value.beatId);
  const name = cleanName(value.name);
  const createdAt = Number.isSafeInteger(value.createdAt) && value.createdAt > 0 ? value.createdAt : 0;
  const updatedAt = Number.isSafeInteger(value.updatedAt) && value.updatedAt >= createdAt ? value.updatedAt : 0;
  if (!id || !beat || !name || !createdAt || !updatedAt) return null;
  return { id, name, beatId: beat.id, mix: normalizeMusicSampleMix(value.mix), createdAt, updatedAt };
}

export function readMusicSavedMixes(storage, ownerId) {
  const key = keyFor(ownerId);
  if (!key) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(parsed)) return [];
    const ids = new Set();
    return parsed.flatMap((candidate) => {
      const item = normalizeMusicSavedMix(candidate);
      if (!item || ids.has(item.id)) return [];
      ids.add(item.id);
      return [item];
    }).sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
      .slice(0, MAX_MUSIC_SAVED_MIXES);
  } catch {
    return [];
  }
}

function newId(now) {
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 16)
    || Math.random().toString(36).slice(2, 14);
  return `mix-${now.toString(36)}-${random}`;
}

export function saveMusicSavedMix(storage, ownerId, value, now = Date.now()) {
  const key = keyFor(ownerId);
  const beat = getMusicDiscoverSeed(value?.beatId);
  const name = cleanName(value?.name) || (beat ? `${beat.title} mix` : '');
  if (!key || !beat || !name || !Number.isSafeInteger(now) || now <= 0) return null;
  const current = readMusicSavedMixes(storage, ownerId);
  const requestedId = isMusicSavedMixId(value?.id) ? value.id : '';
  const previous = requestedId ? current.find((item) => item.id === requestedId) : null;
  const item = {
    id: previous?.id || newId(now),
    name,
    beatId: beat.id,
    mix: normalizeMusicSampleMix(value.mix),
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
  const next = [item, ...current.filter((candidate) => candidate.id !== item.id)]
    .slice(0, MAX_MUSIC_SAVED_MIXES);
  storage.setItem(key, JSON.stringify(next));
  return item;
}
