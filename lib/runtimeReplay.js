import { select } from '../packages/db/supabase-client.js';

// Used only while paused. Existing jobs retain their normal replay/recovery
// contract; a key is trusted only after resolving its owner from verified auth.
export async function hasRuntimeReplay(authId, key, cfg, read = select) {
  try {
    const users = await read('users', { columns: 'id', filter: `auth_id=eq.${encodeURIComponent(authId)}`, limit: 1 }, cfg);
    if (!users?.[0]?.id) return false;
    const jobs = await read('jobs', { columns: 'id', filter: `user_id=eq.${encodeURIComponent(users[0].id)}&idempotency_key=eq.${encodeURIComponent(key)}`, limit: 1 }, cfg);
    return Boolean(jobs?.[0]?.id);
  } catch { return false; }
}
