import { publishRuntimeFeatureEnabled } from './runtimeFlags.js';

// Public capabilities only: safe to share with the browser. Deployment
// readiness is resolved separately by the server, never inferred from logos.
export const SOCIAL_NETWORKS = [
    { key: 'instagram', carousel: { min: 2, max: 10, types: ['image', 'video'] }, label: 'Instagram', media: ['image', 'video'], captionLimit: 2200 },
    { key: 'linkedin', carousel: { min: 2, max: 9, types: ['image'] }, label: 'LinkedIn', media: ['image'], captionLimit: 3000 },
    { key: 'twitter', carousel: { min: 2, max: 4, types: ['image'] }, label: 'X', media: ['image'], captionLimit: 280 },
    { key: 'tiktok', carousel: { min: 2, max: 10, types: ['image'] }, label: 'TikTok', media: ['image', 'video'], captionLimit: 2200, note: 'Delivered to your TikTok inbox to finish in the app.' },
    { key: 'youtube', label: 'YouTube', media: ['video'], captionLimit: 4000 },
    { key: 'facebook', carousel: { min: 2, max: 10, types: ['image'] }, label: 'Facebook', media: ['image', 'video'], captionLimit: 4000, extended: true, resource: 'Page' },
    { key: 'threads', carousel: { min: 2, max: 10, types: ['image'] }, label: 'Threads', media: ['image'], captionLimit: 500, extended: true },
    { key: 'pinterest', label: 'Pinterest', media: ['image'], captionLimit: 800, extended: true, resource: 'board' },
    { key: 'bluesky', carousel: { min: 2, max: 4, types: ['image'] }, label: 'Bluesky', media: ['image'], captionLimit: 300, extended: true, credentials: true, note: 'Bluesky-hosted accounts; images up to 1 MB.' },
    { key: 'twitch', label: 'Twitch', media: [], extended: true, note: 'Connect for video statistics. Image and video uploads are unavailable through Twitch’s API.' },
    { key: 'gmb', label: 'Google Business Profile', media: ['image'], captionLimit: 1500, extended: true, resource: 'location' },
];
// The catalogue is a product choice; retain provider metadata for existing
// accounts and post history even when a platform is no longer offered.
export const SOCIAL_CATALOGUE = SOCIAL_NETWORKS.filter((network) => network.key !== 'pinterest');
export const networkDetails = (key) => SOCIAL_NETWORKS.find((n) => n.key === key);
export const extendedNetworksEnabled = (env = process.env) => env.PUBLISH_EXTENDED_NETWORKS_ENABLED === 'true';

// Unset preserves existing deployments. An explicit empty or unknown list
// releases no platforms; '*' is the staging opt-in to all known platforms.
export function networkReleased(key, env = process.env) {
    if (!networkDetails(key)) return false;
    const value = env.PUBLISH_RELEASED_NETWORKS;
    if (value === undefined || value === '*') return true;
    return typeof value === 'string' && value.split(',').map((name) => name.trim()).includes(key);
}

export function networkEnabled(key, env = process.env) {
    const network = networkDetails(key);
    return networkReleased(key, env) && (!network.extended || extendedNetworksEnabled(env));
}

export const NATIVE_VIDEO_NETWORKS = new Set(['instagram', 'facebook', 'tiktok']);
export const nativeVideoEnabled = (env = process.env) => publishRuntimeFeatureEnabled('PUBLISH_VIDEO_DESTINATIONS_ENABLED', env);
// Video pull transports need the deployed, signed HTTPS media proxy too.
function nativeVideoTransportReady(env) {
    if (!nativeVideoEnabled(env) || typeof env.SOCIAL_MEDIA_PROXY_SECRET !== 'string' || !env.SOCIAL_MEDIA_PROXY_SECRET.trim()) return false;
    try { const url = new URL(env.PUBLIC_HOST); return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash; }
    catch { return false; }
}
// Potential adapter support is distinct from the media released on this Worker.
export function networkMedia(key, env = process.env) {
    const network = networkDetails(key);
    return network?.media.filter(type => type !== 'video' || !NATIVE_VIDEO_NETWORKS.has(key) || nativeVideoTransportReady(env)) || [];
}
