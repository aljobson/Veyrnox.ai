/**
 * Where each aspect ratio is the native shape. Platform names are brand names and stay as written in every
 * language. A ratio a model declares is shown with the places it fits, so a creator picks "TikTok" and gets 9:16.
 */
export const ASPECT_PLATFORMS = Object.freeze({
    '16:9': ['YouTube', 'Facebook', 'LinkedIn'],
    '9:16': ['TikTok', 'Reels', 'Shorts', 'Snapchat'],
    '1:1': ['Instagram', 'Facebook', 'LinkedIn'],
    '4:5': ['Instagram', 'Facebook'],
    '3:4': ['Pinterest'],
    '4:3': ['Facebook'],
    '21:9': ['Cinema'],
});

/** Platforms a ratio fits, or []. */
export const platformsFor = aspect => (Object.hasOwn(ASPECT_PLATFORMS, aspect) ? ASPECT_PLATFORMS[aspect] : []);

/** "9:16 · TikTok, Reels" style label for a pill. */
export const aspectLabel = aspect => {
    const names = platformsFor(aspect).slice(0, 2);
    return names.length ? `${aspect} · ${names.join(', ')}` : aspect;
};
