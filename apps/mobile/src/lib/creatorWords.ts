// How Vibe Check answers rank templates (server ADR-0251). The twin of lib/creatorWords.js; tests/creatorWordsParity.test.mjs
// checks the two agree. Self-contained (no imports) so that test can load it directly.
export const GOAL_WORDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    sell: ['product', ' ad ', 'advert', 'unbox', 'brand', 'sale', 'shop', 'commercial'],
    story: ['story', 'film', 'cinematic', 'scene', 'trailer', 'short'],
    music_video: ['music', 'lyric', 'dance', 'song', 'band', 'concert'],
    meme: ['meme', 'funny', 'reaction', 'viral', 'joke', 'parody'],
    character: ['character', 'portrait', 'avatar', 'mascot', 'persona'],
    bedtime: ['bedtime', 'lullaby', 'kids', 'children', 'fairy', 'storybook', 'sleep'],
});
export const LOOK_WORDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    neon_rain: ['neon', 'rain', 'cyber', 'night'],
    sunlit_kitchen: ['kitchen', 'sunlit', 'warm', 'cozy', 'food'],
    retro_vhs: ['vhs', 'retro', 'vintage', '80s', '90s', 'analog'],
    dream_anime: ['anime', 'dream', 'manga', 'pastel'],
    glossy_product: ['product', 'glossy', 'studio', 'packshot', 'luxury'],
    doc_grit: ['documentary', 'gritty', 'handheld', 'raw', 'street'],
});

export const GOAL_WEIGHT = 3;
export const LOOK_WEIGHT = 1;
export const MAX_HITS = 2;

function hits(text: string, words: readonly string[] | undefined): number {
    if (!words) return 0;
    let n = 0;
    for (const w of words) if (text.includes(w)) n += 1;
    return n;
}

// Score for text such as `${title} ${category} ${prompt}`; any case, any padding.
export function tasteScoreText(text: string, answers: { readonly goal?: unknown; readonly look?: unknown } | null | undefined): number {
    if (!answers || typeof answers !== 'object') return 0;
    const t = ` ${String(text)} `.toLowerCase();
    const goal = typeof answers.goal === 'string' && Object.hasOwn(GOAL_WORDS, answers.goal) ? GOAL_WORDS[answers.goal] : undefined;
    const look = typeof answers.look === 'string' && Object.hasOwn(LOOK_WORDS, answers.look) ? LOOK_WORDS[answers.look] : undefined;
    return GOAL_WEIGHT * Math.min(hits(t, goal), MAX_HITS) + LOOK_WEIGHT * Math.min(hits(t, look), MAX_HITS);
}
