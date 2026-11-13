// Library favourites: job ids the user starred, kept per account in this
// browser (like the job-history cache). With library sync on (ADR-0340) the
// account holds the same list, so a favourite follows the person to the phone;
// this copy is what shows first and what stands when the server cannot be reached.

const PREFIX = 'veyrnox_favourites_v1:';
export const MAX_FAVOURITES = 200;
import { isUuidLoose } from '../../../lib/validate.js';

const keyFor = (userId) => (typeof userId === 'string' && userId ? PREFIX + userId : null);

/** @returns {string[]} newest first; empty when signed out or storage is blocked */
export function readFavourites(storage, userId) {
  const key = keyFor(userId);
  if (!key) return [];
  try {
    const arr = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(arr) ? arr.filter((id) => typeof id === 'string' && isUuidLoose(id)).slice(0, MAX_FAVOURITES) : [];
  } catch {
    return [];
  }
}

/** Star or unstar a job. Returns the new list; unchanged when it cannot be saved. */
export function toggleFavourite(storage, userId, jobId) {
  const current = readFavourites(storage, userId);
  const key = keyFor(userId);
  if (!key || !isUuidLoose(String(jobId))) return current;
  const next = current.includes(jobId) ? current.filter((id) => id !== jobId) : [jobId, ...current].slice(0, MAX_FAVOURITES);
  try {
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}

// ADR-0340: once the account holds favourites (/api/v1/library-sync), the account's list is the truth. The first time a
// browser meets the server list for an account it may hold stars of its own that predate sync: they are kept and handed
// back to upload, once. After that the server list replaces the local one, so an unstar made on another device holds.
const SYNCED_PREFIX = 'veyrnox_favourites_synced_v1:';

/** @returns {{ ids: string[], upload: string[] }} the list to show, and the ids only this browser had (first sync only) */
export function reconcileFavourites(storage, userId, serverIds) {
  const key = keyFor(userId);
  if (!key) return { ids: [], upload: [] };
  const server = (Array.isArray(serverIds) ? serverIds : []).filter((id) => typeof id === 'string' && isUuidLoose(id)).slice(0, MAX_FAVOURITES);
  let first = false;
  try { first = storage.getItem(SYNCED_PREFIX + userId) !== '1'; } catch { first = false; }
  const upload = first ? readFavourites(storage, userId).filter((id) => !server.includes(id)) : [];
  const ids = [...upload, ...server].slice(0, MAX_FAVOURITES);
  try {
    storage.setItem(key, JSON.stringify(ids));
    storage.setItem(SYNCED_PREFIX + userId, '1');
  } catch { /* the list still shows; it is read again next time */ }
  return { ids, upload };
}
