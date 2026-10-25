import { SOCIAL_NETWORKS } from './networks.js';

export function carouselDocumentation() {
    const limits = SOCIAL_NETWORKS.filter(network => network.carousel).map(({ label, carousel }) =>
        `${label}: ${carousel.min}-${carousel.max} ${carousel.types.includes('video') ? 'images and/or videos' : 'images'}`).join('; ');
    return `Attachments are published in the supplied order. Multiple files may not be enabled for the account; the API returns carousel_not_open when unavailable. Every destination must support the count and types: ${limits}. Unsupported combinations return media_count_not_supported with the blocking network. YouTube and Google Business Profile accept one file; Twitch cannot publish. The first Instagram item sets the crop.`;
}
