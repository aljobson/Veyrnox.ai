/**
 * How Vibe Check answers rank templates (ADR-0251). Pure and total: with no answers
 * nothing moves, and a score only reorders; it never changes what a template does or
 * costs. The phone has a twin, apps/mobile/src/lib/creatorWords.ts, and
 * tests/creatorWordsParity.test.mjs checks the two agree.
 */

// Words that mark a template as fitting a goal or a look. Matched against the title,
// category and prompt, lower-cased and padded with a space on each side.
export const GOAL_WORDS = Object.freeze({
    sell: ['product', ' ad ', 'advert', 'unbox', 'brand', 'sale', 'shop', 'commercial'],
    story: ['story', 'film', 'cinematic', 'scene', 'trailer', 'short'],
    music_video: ['music', 'lyric', 'dance', 'song', 'band', 'concert'],
    meme: ['meme', 'funny', 'reaction', 'viral', 'joke', 'parody'],
    character: ['character', 'portrait', 'avatar', 'mascot', 'persona'],
    bedtime: ['bedtime', 'lullaby', 'kids', 'children', 'fairy', 'storybook', 'sleep'],
});
export const LOOK_WORDS = Object.freeze({
    neon_rain: ['neon', 'rain', 'cyber', 'night'],
    sunlit_kitchen: ['kitchen', 'sunlit', 'warm', 'cozy', 'food'],
    retro_vhs: ['vhs', 'retro', 'vintage', '80s', '90s', 'analog'],
    dream_anime: ['anime', 'dream', 'manga', 'pastel'],
    glossy_product: ['product', 'glossy', 'studio', 'packshot', 'luxury'],
    doc_grit: ['documentary', 'gritty', 'handheld', 'raw', 'street'],
});

export const GOAL_WEIGHT = 3;
export const LOOK_WEIGHT = 1;
// A few matching words count, a flood of them does not.
export const MAX_HITS = 2;

function hits(text, words) {
    if (!Array.isArray(words)) return 0;
    let n = 0;
    for (const w of words) if (text.includes(w)) n += 1;
    return n;
}

/** Score for text such as `${title} ${category} ${prompt}`; any case, any padding. */
export function tasteScoreText(text, answers) {
    if (!answers || typeof answers !== 'object') return 0;
    const t = ` ${String(text)} `.toLowerCase();
    const goal = Object.hasOwn(GOAL_WORDS, answers.goal) ? GOAL_WORDS[answers.goal] : undefined;
    const look = Object.hasOwn(LOOK_WORDS, answers.look) ? LOOK_WORDS[answers.look] : undefined;
    return GOAL_WEIGHT * Math.min(hits(t, goal), MAX_HITS) + LOOK_WEIGHT * Math.min(hits(t, look), MAX_HITS);
}

/** Items that fit first; ties keep their order. With no answers, a copy in the same order. */
export function rankByTaste(items, answers, textOf) {
    if (!answers) return [...items];
    return items
        .map((item, i) => ({ item, i, s: tasteScoreText(textOf(item), answers) }))
        .sort((x, y) => y.s - x.s || x.i - y.i)
        .map((x) => x.item);
}
