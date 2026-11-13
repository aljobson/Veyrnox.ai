// Where each aspect ratio is the native shape (mirrors lib/platformFormats.js on the web). Platform names are
// brand names and stay as written in every language.
const ASPECT_PLATFORMS: Readonly<Record<string, readonly string[]>> = {
    '16:9': ['YouTube', 'Facebook', 'LinkedIn'],
    '9:16': ['TikTok', 'Reels', 'Shorts', 'Snapchat'],
    '1:1': ['Instagram', 'Facebook', 'LinkedIn'],
    '4:5': ['Instagram', 'Facebook'],
    '3:4': ['Pinterest'],
    '4:3': ['Facebook'],
    '21:9': ['Cinema'],
};

export const platformsFor = (aspect: string): readonly string[] => ASPECT_PLATFORMS[aspect] ?? [];

// "9:16 · TikTok, Reels" for a chip.
export function aspectLabel(aspect: string): string {
    const names = platformsFor(aspect).slice(0, 2);
    return names.length ? `${aspect} · ${names.join(', ')}` : aspect;
}
