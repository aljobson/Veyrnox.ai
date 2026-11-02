import { networkReleased } from './networks.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Server-only admission: authId is the middleware-verified JWT subject.
export function metaReviewAllowed(network, authId, env = process.env) {
    if (!['facebook', 'instagram'].includes(network) || networkReleased(network, env)
        || env.META_REVIEW_ENABLED !== 'true' || env.PUBLISH_ENABLED !== 'true'
        || typeof authId !== 'string' || !UUID.test(authId)) return false;
    try {
        const host = new URL(env.PUBLIC_HOST);
        if (host.origin !== 'https://veyrnox.ai' || host.pathname !== '/' || host.search
            || host.hash || host.username || host.password) return false;
    } catch { return false; }
    return (env.META_REVIEW_AUTH_IDS || '').split(',').map(id => id.trim().toLowerCase())
        .some(id => UUID.test(id) && id === authId.toLowerCase());
}
export function metaAvailable(network, authId, env = process.env) {
    return networkReleased(network, env) || metaReviewAllowed(network, authId, env);
}
