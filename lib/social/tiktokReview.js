import { networkReleased } from './networks.js';

const AUTH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only a middleware-verified JWT subject can open the first-review sandbox
// on the production website. The public release list remains authoritative.
export function tiktokReviewAllowed(authId, env = process.env) {
    if (networkReleased('tiktok', env) || env.TIKTOK_REVIEW_ENABLED !== 'true'
        || typeof authId !== 'string' || !AUTH_ID.test(authId)) return false;
    const allowed = (env.TIKTOK_REVIEW_AUTH_IDS || '').split(',')
        .map((id) => id.trim().toLowerCase()).filter((id) => AUTH_ID.test(id));
    return allowed.includes(authId.toLowerCase());
}

export function tiktokAvailable(authId, env = process.env) {
    return networkReleased('tiktok', env) || tiktokReviewAllowed(authId, env);
}

