/**
 * Account deletion (ADR-0111). Off until ACCOUNT_DELETION_ENABLED is "true";
 * production vars are at the binding cap, so the flag is not in wrangler.jsonc.
 */
import { fetchWithTimeout } from './fetchWithTimeout.js';

export function accountDeletionEnabled(env = process.env) {
    return env.ACCOUNT_DELETION_ENABLED === 'true';
}

// Why an erasure was refused, and what the person can do. The app shows its
// own words; these are the codes it can branch on.
export const DELETION_BLOCKERS = [
    'account_frozen', 'account_on_hold', 'active_subscription', 'generation_in_progress',
    'top_up_in_progress', 'cinema_content_present', 'projects_present', 'publish_team_present',
    'voice_profile_present',
];

/**
 * Remove the identity from Supabase Auth (hard delete, sessions and identities
 * go with it). 404 means it is already gone, which is the outcome we want.
 * Returns true when the user no longer exists.
 */
export async function deleteAuthUser(authId, cfg) {
    const res = await fetchWithTimeout(new URL(`/auth/v1/admin/users/${encodeURIComponent(authId)}`, cfg.supabaseUrl), {
        method: 'DELETE',
        headers: {
            apikey: cfg.serviceRoleKey,
            Authorization: `Bearer ${cfg.serviceRoleKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ should_soft_delete: false }),
    });
    return res.ok || res.status === 404;
}
