// One account lock protects both the claim and its history settlement write.
export const WATCH_MAX_AGE_MS = 60 * 60 * 1000;
const PREFIX = 'veyrnox_generation_claims_v1:';
const MAX = 1000;
export function createGenerationClaimer() {
  const seen = new Map();
  return async function claim({ owner, id, submittedAt, currentOwner, settle, storage, locks, now = Date.now() }) {
    if (!owner || !id) return false;
    const run = () => {
      if (currentOwner() !== owner) return false;
      const key = PREFIX + owner;
      for (const [k, time] of seen) if (now - time >= WATCH_MAX_AGE_MS) seen.delete(k);
      let claims = [];
      try { claims = JSON.parse(storage?.getItem(key) || '[]'); } catch { /* memory fallback */ }
      claims = (Array.isArray(claims) ? claims : []).filter(c => typeof c?.id === 'string' && Number.isFinite(c.at) && now - c.at < WATCH_MAX_AGE_MS);
      const token = JSON.stringify([owner, id]);
      const eligible = Number.isFinite(submittedAt) && submittedAt <= now && now - submittedAt < WATCH_MAX_AGE_MS;
      const winner = eligible && !seen.has(token) && !claims.some(c => c.id === id);
      // settle reads history again INSIDE this lock; already settled/replayed entries lose.
      const transition = settle();
      if (!winner || !transition) return false;
      seen.set(token, submittedAt);
      while (seen.size > MAX) seen.delete(seen.keys().next().value);
      claims.push({ id, at: submittedAt });
      try { storage?.setItem(key, JSON.stringify(claims.slice(-MAX))); } catch { /* same-tab dedupe remains */ }
      return true;
    };
    if (locks?.request) {
      try { return await locks.request(PREFIX + owner, run); } catch { /* unavailable in this browser context */ }
    }
    return run();
  };
}
