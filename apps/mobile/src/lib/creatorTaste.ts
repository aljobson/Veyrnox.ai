import type { CreatorAnswers } from './creatorAnswers';
import { heroPicks, needsPhoto, presetKind } from './explore';
import type { Preset } from './presets';

// How the Vibe Check answers steer the app (server ADR-0251). Both functions are pure and total: with no answers they
// return their input unchanged, so a person who skipped sees exactly what everyone else sees. Nothing here touches
// credits, price or what a template does; it only reorders and picks a default.

// Words that mark a template as fitting a goal or a look. Matched against the title, category and prompt, lower-cased.
const GOAL_WORDS: Readonly<Record<string, readonly string[]>> = {
    sell: ['product', ' ad ', 'advert', 'unbox', 'brand', 'sale', 'shop', 'commercial'],
    story: ['story', 'film', 'cinematic', 'scene', 'trailer', 'short'],
    music_video: ['music', 'lyric', 'dance', 'song', 'band', 'concert'],
    meme: ['meme', 'funny', 'reaction', 'viral', 'joke', 'parody'],
    character: ['character', 'portrait', 'avatar', 'mascot', 'persona'],
    bedtime: ['bedtime', 'lullaby', 'kids', 'children', 'fairy', 'storybook', 'sleep'],
};
const LOOK_WORDS: Readonly<Record<string, readonly string[]>> = {
    neon_rain: ['neon', 'rain', 'cyber', 'night'],
    sunlit_kitchen: ['kitchen', 'sunlit', 'warm', 'cozy', 'food'],
    retro_vhs: ['vhs', 'retro', 'vintage', '80s', '90s', 'analog'],
    dream_anime: ['anime', 'dream', 'manga', 'pastel'],
    glossy_product: ['product', 'glossy', 'studio', 'packshot', 'luxury'],
    doc_grit: ['documentary', 'gritty', 'handheld', 'raw', 'street'],
};

const GOAL_WEIGHT = 3;
const LOOK_WEIGHT = 1;

function hits(text: string, words: readonly string[] | undefined): number {
    if (!words) return 0;
    let n = 0;
    for (const w of words) if (text.includes(w)) n += 1;
    return n;
}

export function tasteScore(p: Pick<Preset, 'title' | 'category' | 'prompt'>, a: Pick<CreatorAnswers, 'goal' | 'look'>): number {
    const text = ` ${p.title} ${p.category} ${p.prompt} `.toLowerCase();
    return GOAL_WEIGHT * Math.min(hits(text, GOAL_WORDS[a.goal]), 2) + LOOK_WEIGHT * Math.min(hits(text, LOOK_WORDS[a.look]), 2);
}

// Templates that match the person's goal and look first; everything else keeps the order the server sent it in.
export function rankPresets(presets: readonly Preset[], answers: CreatorAnswers | null): Preset[] {
    if (!answers) return [...presets];
    return presets
        .map((p, i) => ({ p, i, s: tasteScore(p, answers) }))
        .sort((x, y) => y.s - x.s || x.i - y.i)
        .map((x) => x.p);
}

// The aspect ratio a model opens on. Where the person said where the result will land, a matching ratio wins when the
// model offers it; otherwise today's rule holds (16:9 if offered, else the first one).
const DESTINATION_ASPECT: Readonly<Record<string, string>> = { tiktok: '9:16', reels: '9:16', youtube: '16:9', cinema: '16:9' };

export function defaultAspect(aspects: readonly string[], answers: Pick<CreatorAnswers, 'destination'> | null): string | null {
    const wanted = answers ? DESTINATION_ASPECT[answers.destination] : undefined;
    if (wanted && aspects.includes(wanted)) return wanted;
    return aspects.includes('16:9') ? '16:9' : (aspects[0] ?? null);
}

// The home's few lead templates. With no answers this is today's heroPicks. With answers, templates that fit the goal and
// look come first (words-only before photo-first, new before old, one per category where there are enough), and any
// slots left are filled the usual way, so the row never comes up short.
export function tastePicks(presets: readonly Preset[], answers: CreatorAnswers | null, count = 3): Preset[] {
    const usual = heroPicks(presets, count);
    if (!answers) return usual;
    const fits = presets
        .map((p, i) => ({ p, i, s: tasteScore(p, answers) }))
        .filter((x) => x.s > 0 && x.p.posterUrl && presetKind(x.p) !== 'audio')
        .sort((x, y) => y.s - x.s || Number(needsPhoto(x.p)) - Number(needsPhoto(y.p)) || Number(y.p.isNew) - Number(x.p.isNew) || x.i - y.i)
        .map((x) => x.p);
    const picks: Preset[] = [];
    const categories = new Set<string>();
    for (const p of fits) {
        if (picks.length === count) break;
        if (categories.has(p.category)) continue;
        categories.add(p.category);
        picks.push(p);
    }
    for (const p of [...fits, ...usual]) {
        if (picks.length === count) break;
        if (!picks.includes(p)) picks.push(p);
    }
    return picks;
}
