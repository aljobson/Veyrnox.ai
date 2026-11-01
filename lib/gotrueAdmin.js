import { fetchWithTimeout } from './fetchWithTimeout.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function request(userId, factorId, cfg) {
    if (!UUID_RE.test(userId) || (factorId !== undefined && !UUID_RE.test(factorId))) throw new Error('invalid_factor_id');
    if (!cfg.supabaseUrl || !cfg.serviceRoleKey) throw new Error('recovery_not_configured');
    // Only server configuration chooses the host; caller identifiers cannot change it.
    const path = `/auth/v1/admin/users/${userId}${factorId === undefined ? '' : `/factors/${factorId}`}`;
    const response = await fetchWithTimeout(new URL(path, cfg.supabaseUrl), {
        method: factorId === undefined ? 'GET' : 'DELETE',
        redirect: 'error',
        headers: { apikey: cfg.serviceRoleKey, Authorization: `Bearer ${cfg.serviceRoleKey}` },
    }, cfg.timeoutMs ?? 8000);
    if (factorId !== undefined && response.status === 404) return null;
    if (!response.ok) throw new Error('recovery_upstream_unavailable');
    return factorId === undefined ? response.json() : null;
}

export async function adminListUserFactors(userId, cfg) {
    const user = await request(userId, undefined, cfg);
    if (!user || (user.factors !== undefined && !Array.isArray(user.factors))) throw new Error('recovery_upstream_unavailable');
    return (user.factors || []).filter(f => f.factor_type === 'totp' && f.status === 'verified');
}

export async function adminDeleteFactor(userId, factorId, cfg) {
    await request(userId, factorId, cfg);
}
