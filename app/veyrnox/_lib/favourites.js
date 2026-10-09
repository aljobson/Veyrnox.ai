// Library favourites: job ids the user starred, kept per account in this
// browser (like the job-history cache). Nothing is sent to the server, so a
// favourite does not follow the user to another device.

const PREFIX = 'veyrnox_favourites_v1:';
export const MAX_FAVOURITES = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyFor = (userId) => (typeof userId === 'string' && userId ? PREFIX + userId : null);

/** @returns {string[]} newest first; empty when signed out or storage is blocked */
export function readFavourites(storage, userId) {
  const key = keyFor(userId);
  if (!key) return [];
  try {
    const arr = JSON.parse(storage.getItem(key) || '[]');
    return Array.isArray(arr) ? arr.filter((id) => typeof id === 'string' && UUID_RE.test(id)).slice(0, MAX_FAVOURITES) : [];
  } catch {
    return [];
  }
}

/** Star or unstar a job. Returns the new list; unchanged when it cannot be saved. */
export function toggleFavourite(storage, userId, jobId) {
  const current = readFavourites(storage, userId);
  const key = keyFor(userId);
  if (!key || !UUID_RE.test(String(jobId))) return current;
  const next = current.includes(jobId) ? current.filter((id) => id !== jobId) : [jobId, ...current].slice(0, MAX_FAVOURITES);
  try {
    storage.setItem(key, JSON.stringify(next));
    return next;
  } catch {
    return current;
  }
}
