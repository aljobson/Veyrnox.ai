import { publicHandle, publicSlug } from './validatePublic';
export function publicTrackUrl(slug: string): string {
    if (!publicSlug(slug)) throw new Error('invalid_music_slug');
    return `https://veyrnox.ai/music/tracks/${slug}`;
}
export function publicCreatorUrl(handle: string): string {
    if (!publicHandle(handle)) throw new Error('invalid_music_handle');
    return `https://veyrnox.ai/music/creators/${handle}`;
}
