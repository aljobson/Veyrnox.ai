export const ANALYTICS_CAPABILITIES = Object.freeze({
    instagram: ['Followers', 'Posts', 'Interactions', 'Reach', 'Views', 'Best time'],
    youtube: ['Subscribers', 'Videos', 'Interactions', 'Views', 'Best time'],
    tiktok: ['Followers', 'Videos', 'Interactions', 'Views', 'Best time'],
    twitter: ['Followers', 'Posts', 'Interactions', 'Impressions', 'Best time'],
    twitch: ['Videos', 'Views'],
});

export function analyticsCapabilities(network) {
    return ANALYTICS_CAPABILITIES[network] || [];
}

export function hasAnalytics(network) {
    return analyticsCapabilities(network).length > 0;
}
