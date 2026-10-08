// Public capabilities only: safe to share with the browser. Deployment
// readiness is resolved separately by the server, never inferred from logos.
export const SOCIAL_NETWORKS = [
    { key: 'instagram', label: 'Instagram', media: ['image'], captionLimit: 2200 },
    { key: 'linkedin', label: 'LinkedIn', media: ['image'], captionLimit: 3000 },
    { key: 'twitter', label: 'X', media: ['image'], captionLimit: 280 },
    { key: 'tiktok', label: 'TikTok', media: ['image'], captionLimit: 2200, note: 'Delivered to your TikTok inbox to finish in the app.' },
    { key: 'youtube', label: 'YouTube', media: ['video'], captionLimit: 4000 },
    { key: 'facebook', label: 'Facebook', media: ['image'], captionLimit: 4000, extended: true, resource: 'Page' },
    { key: 'threads', label: 'Threads', media: ['image'], captionLimit: 500, extended: true },
    { key: 'pinterest', label: 'Pinterest', media: ['image'], captionLimit: 800, extended: true, resource: 'board' },
    { key: 'bluesky', label: 'Bluesky', media: ['image'], captionLimit: 300, extended: true, credentials: true, note: 'Bluesky-hosted accounts; images up to 1 MB.' },
    { key: 'twitch', label: 'Twitch', media: [], extended: true, note: 'Connect for video statistics. Image and video uploads are unavailable through Twitch’s API.' },
    { key: 'gmb', label: 'Google Business Profile', media: ['image'], captionLimit: 1500, extended: true, resource: 'location' },
];
export const networkDetails = (key) => SOCIAL_NETWORKS.find((n) => n.key === key);
export const extendedNetworksEnabled = (env = process.env) => env.PUBLISH_EXTENDED_NETWORKS_ENABLED === 'true';
