// The Oddling builder's logic, ported from the web (app/veyrnox/_lib/character.js, characterOptions.js, oddlingStudio.js).
// The option data is generated (scripts/sync-oddlings-cast.mjs). A test runs the web files and this port over the same
// picks and compares the prompts, so the two cannot drift. Pure: no storage, no network, no price.
import builder from './oddlings/builder.json';
import cast from './oddlings/cast.json';

export type Picks = Record<string, string>;
export type Random = () => number;
type Option = readonly [value: string, phrase: string, label: string];
interface Group { readonly id: string; readonly tab: string; readonly label: string; readonly options: readonly Option[] }
type Pair = readonly [string, string];
interface Motion { readonly id: string; readonly name: string; readonly phrase: string }
export interface Category { readonly id: string; readonly label: string; readonly hint: string; readonly groupIds: readonly string[] }

export const GROUPS = builder.groups as unknown as readonly Group[];
export const TONES = builder.tones as unknown as readonly Pair[];
export const SHOWS = builder.shows as unknown as readonly Pair[];
export const MOTIONS = builder.motions as readonly Motion[];
export const SCENES = builder.scenes as readonly string[];
export const CATEGORIES = builder.categories as unknown as readonly Category[];
export const CATEGORY_FOCUS = builder.focus as Record<string, string>;
const SWATCHES = builder.swatches as Record<string, Record<string, { swatch: string }>>;

// The colour a hair, skin or eye option stands for, so a picker can show it.
export const swatchOf = (groupId: string, value: string): string | null => SWATCHES[groupId]?.[value]?.swatch ?? null;
export const PROMPT_MAX = 2000;
const TEXT_LIMITS: Record<string, number> = { oddling_name: 40, oddling_obsession: 140, oddling_rule: 160 };

export const groupById = (id: string): Group | null => GROUPS.find((g) => g.id === id) ?? null;

// Two picks that cannot both be true: the first side is the everyday choice, the second the surreal one it replaces.
interface Side { readonly key: string; readonly values?: readonly string[] }
const BROWS: Side = { key: 'brows', values: ['Thick', 'Thin', 'Arched', 'Straight', 'Bushy', 'Bleached'] };
const BROW_DETAILS: Side = { key: 'face_features', values: ['Tiny Brows', 'One Brow'] };
const CHROME_BROWS: Side = { key: 'accessories', values: ['Chrome Brows'] };
const EYEWEAR: Side = { key: 'everyday_accessories', values: ['Glasses', 'Round Glasses', 'Sunglasses'] };
const SURREAL_EYEWEAR: Side = { key: 'accessories', values: ['Tiny Sunglasses', 'Tiny Monocle'] };
const BAG: Side = { key: 'everyday_accessories', values: ['Everyday Bag', 'Tote Bag'] };
const SURREAL_HANDBAG: Side = { key: 'accessories', values: ['Tiny Handbag', 'Impossible Handbag'] };
const HANDBAG_PROP: Side = { key: 'distinctive_features', values: ['Impossible Handbag'] };
const HEADWEAR: Side = { key: 'headwear', values: ['Baseball Cap', 'Beanie', 'Wide-Brim Hat', 'Bucket Hat', 'Headphones'] };
const HEAD_MASK: Side = { key: 'accessories', values: ['Bug Head Mask'] };
const EXCLUSIVE_PAIRS: readonly (readonly [Side, Side])[] = [
    [BROWS, BROW_DETAILS], [BROWS, CHROME_BROWS], [EYEWEAR, SURREAL_EYEWEAR], [EYEWEAR, HEAD_MASK], [BAG, SURREAL_HANDBAG], [BAG, HANDBAG_PROP], [HEADWEAR, HEAD_MASK],
];
const CONFLICT_TOPICS: Record<string, readonly Side[]> = {
    brows: [BROWS, BROW_DETAILS, CHROME_BROWS], eyewear: [EYEWEAR, SURREAL_EYEWEAR], bags: [BAG, SURREAL_HANDBAG, HANDBAG_PROP], head_covering: [HEADWEAR, HEAD_MASK],
};

const sideMatches = (side: Side, key: string, value: string | undefined): boolean => side.key === key && Boolean(value) && (!side.values || side.values.includes(value as string));
const conflictTopicPicks = (topic: string, picks: Picks): string => CONFLICT_TOPICS[topic].map((s) => (sideMatches(s, s.key, picks[s.key]) ? picks[s.key] : '')).join('|');

export function resolveExclusive(picks: Picks): Picks {
    const next = { ...picks };
    for (const [keep, drop] of EXCLUSIVE_PAIRS) if (sideMatches(keep, keep.key, picks[keep.key]) && sideMatches(drop, drop.key, next[drop.key])) delete next[drop.key];
    return next;
}

// One hand edit, with every contradiction it causes settled the way the web settles it.
export function changePick(picks: Picks, key: string, value: string): Picks {
    const next = { ...picks };
    if (value) next[key] = value; else delete next[key];
    for (const [a, b] of EXCLUSIVE_PAIRS) {
        if (sideMatches(a, key, value) && sideMatches(b, b.key, next[b.key])) delete next[b.key];
        if (sideMatches(b, key, value) && sideMatches(a, a.key, next[a.key])) delete next[a.key];
    }
    const is = (v: string | undefined, list: string[]) => Boolean(v) && list.includes(v as string);
    if (key === 'hand_size' && value && is(next.proportions, ['Huge Hands', 'Tiny Hands'])) delete next.proportions;
    if (key === 'proportions' && is(value, ['Huge Hands', 'Tiny Hands'])) delete next.hand_size;
    if (key === 'ear_size' && value && next.ears === 'No Ears') delete next.ears;
    if (key === 'ears' && value === 'No Ears') delete next.ear_size;
    if (key === 'mouth_size' && value && is(next.mouth, ['Small Mouth', 'Large Mouth'])) delete next.mouth;
    if (key === 'mouth' && is(value, ['Small Mouth', 'Large Mouth'])) delete next.mouth_size;
    if (key === 'head_size' && value && is(next.head_shape, ['Tiny Head', 'Oversized Head'])) delete next.head_shape;
    if (key === 'head_shape' && is(value, ['Tiny Head', 'Oversized Head'])) delete next.head_size;
    if (key === 'neck_size' && value && is(next.proportions, ['Long Neck', 'No Visible Neck'])) delete next.proportions;
    if (key === 'proportions' && is(value, ['Long Neck', 'No Visible Neck'])) delete next.neck_size;
    if (key === 'torso_size' && value) {
        if (is(next.proportions, ['Tiny Torso', 'Long Torso'])) delete next.proportions;
        if (is(next.body_type, ['Long Torso', 'Long Legs'])) delete next.body_type;
    }
    if ((key === 'proportions' && is(value, ['Tiny Torso', 'Long Torso'])) || (key === 'body_type' && is(value, ['Long Torso', 'Long Legs']))) delete next.torso_size;
    return next;
}

const oneLine = (value: unknown, max: number): string => String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const optionPhrase = (table: readonly Pair[], value: string | undefined): string => table.find(([label]) => label === value)?.[1] ?? '';

// The phrases for the chosen options. Unknown picks add nothing.
export function characterTraits(raw: Picks): string[] {
    const picks = resolveExclusive(raw);
    const parts: string[] = [];
    for (const g of GROUPS) {
        const hit = g.options.find(([label]) => label === picks[g.id]);
        if (!hit) continue;
        const limb = g.id === 'arm_size' ? 'arm' : g.id === 'leg_size' ? 'leg' : null;
        if (limb) {
            const sides = ['left', 'right'].filter((side) => picks[`${side}_${limb}`] !== 'None');
            if (!sides.length) continue;
            parts.push(sides.length === 1 ? hit[1].replaceAll(`${limb}s`, `${sides[0]} ${limb}`) : hit[1]);
        } else parts.push(hit[1]);
    }
    return parts;
}

// A preset's own canon loses a clause when the pick it describes was changed.
interface CanonCategory { readonly topic?: string; readonly keys?: readonly string[]; readonly words: RegExp }
const BODY_KEYS = ['body_type', 'height', 'proportions', 'torso_size', 'arm_size', 'leg_size', 'hand_size', 'foot_size'];
const CANON_CATEGORIES: readonly CanonCategory[] = [
    { topic: 'brows', words: /\b(?:eyebrows|brows|brow)\b/i },
    { topic: 'eyewear', words: /\b(?:glasses|sunglasses|monocle)\b/i },
    { topic: 'bags', words: /\b(?:handbag|bag|tote)\b/i },
    { topic: 'head_covering', words: /\b(?:helmet|mask|hat|cap|beanie|headphones)\b/i },
    { keys: ['hair', 'hair_color'], words: /\b(?:hair|haircut|afro|pompadour|halo|canopy|quiff|braids|antennae)\b/i },
    { keys: ['wardrobe_style'], words: /\b(?:couture|coat|raincoat|waistcoat|jacket|dress|suit|tracksuit|trousers|jeans|shirt|t-shirt|tailoring|sportswear|robe|gown|cape|boots|trainers|sneakers|jumpsuit|sash|turtleneck|coverall|gloves|tie|pinstripe|sleeves|train)\b/i },
    { keys: BODY_KEYS, words: /\b(?:body|bodybuilder|build|silhouette|torso|hips|limbs|legs|arms|hands|feet|neck|slim|slender|thin|muscular|curvy|pear|barrel|compact|seven-foot|long-limbed|full-bodied|athletic|sturdy|proportions|posture)\b/i },
];
const canonChanged = ({ keys, topic }: CanonCategory, now: Picks, original: Picks): boolean => (topic
    ? conflictTopicPicks(topic, now) !== conflictTopicPicks(topic, original)
    : (keys ?? []).some((key) => (now[key] || '') !== (original[key] || '')));

function inheritedVisualCanon(raw: Picks): string {
    const picks = resolveExclusive(raw);
    const rule = oneLine(picks.oddling_rule, 160);
    const original = rule ? (cast.characters as unknown as { picks: Picks }[]).find((item) => oneLine(item.picks.oddling_rule, 160) === rule)?.picks : undefined;
    if (!original) return rule;
    const changed = CANON_CATEGORIES.filter((c) => canonChanged(c, picks, original));
    return rule.split(',').map((clause) => clause.trim()).filter((clause) => !changed.some(({ words }) => words.test(clause))).join(', ');
}

export function oddlingIdentity(picks: Picks): string[] {
    const parts: string[] = [];
    const name = oneLine(picks.oddling_name, 40);
    const obsession = oneLine(picks.oddling_obsession, 140);
    const rule = inheritedVisualCanon(picks);
    const voice = optionPhrase(TONES, picks.oddling_voice);
    const show = optionPhrase(SHOWS, picks.oddling_show);
    if (name) parts.push(`fictional creator named ${name}`);
    if (obsession) parts.push(`interested in ${obsession}`);
    if (voice) parts.push(voice);
    if (show) parts.push(show);
    if (rule) parts.push(`immutable visual canon: ${rule}`);
    return parts;
}

// The base portrait (always an original adult, not a real person), the traits, the premise, then the user's own text,
// which is what is cut to fit the 2000-character limit, never the character.
export function buildCharacterPrompt(userText: string, picks: Picks): string {
    const head = [builder.base, ...characterTraits(picks), ...oddlingIdentity(picks)].join(', ');
    const extra = String(userText || '').trim();
    return (extra ? `${head}, ${extra}` : head).slice(0, PROMPT_MAX);
}

// Only values the builder offers survive; the creator's own words are trimmed to one line.
export function sanitizePicks(value: unknown): Picks {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const src = value as Record<string, unknown>;
    const clean: Picks = {};
    for (const g of GROUPS) if (g.options.some(([label]) => label === src[g.id])) clean[g.id] = src[g.id] as string;
    for (const key of Object.keys(TEXT_LIMITS)) {
        const text = oneLine(src[key], TEXT_LIMITS[key]);
        if (text) clean[key] = text;
    }
    if (TONES.some(([label]) => label === src.oddling_voice)) clean.oddling_voice = src.oddling_voice as string;
    if (SHOWS.some(([label]) => label === src.oddling_show)) clean.oddling_show = src.oddling_show as string;
    return resolveExclusive(clean);
}

const RANDOM_STYLE_GROUPS = ['hair', 'hair_color', 'head_shape', 'neck', 'eye_shape', 'eye_color', 'face_features', 'facial_hair', 'wardrobe_style', 'accessories', 'distinctive_features', 'rendering_style'];

// Randomize styling: hair, face, wardrobe and finish only.
export function randomizeStyle(picks: Picks, random: Random = Math.random): Picks {
    const next: Picks = { ...sanitizePicks(picks), character_type: picks.character_type || 'Human' };
    for (const id of RANDOM_STYLE_GROUPS) {
        const group = groupById(id);
        if (!group?.options.length) continue;
        const options = id === 'head_shape' && next.head_size ? group.options.filter(([value]) => !['Tiny Head', 'Oversized Head'].includes(value)) : group.options;
        const index = Math.min(options.length - 1, Math.floor(Math.max(0, random()) * options.length));
        next[id] = options[index][0];
    }
    return next;
}

// Surprise me: a whole new look. Medical or injury-flavoured picks are never rolled and stay as the person set them.
const HUMAN_FIRST_ODDS = 0.5;
const EXTRA_GROUP_ODDS = 1 / 3;
const LEFT_ALONE = new Set(['skin_conditions', 'left_arm', 'right_arm', 'left_leg', 'right_leg']);
const AVOIDED: Record<string, ReadonlySet<string>> = { eyes_details: new Set(['Blind Eye', 'Scarred Eye']), eye_color: new Set(['Blind / Empty']), accessories: new Set(['Scarification']) };
const EXTRA_GROUPS = new Set(['eyes_type', 'eyes_details', 'mouth', 'ears', 'horns', 'facial_hair', 'face_skin_material', 'face_surface_pattern']);

export function randomizeAll(picks: Picks, random: Random = Math.random): Picks {
    const roll = (length: number) => Math.min(length - 1, Math.floor(Math.max(0, random()) * length));
    const current = sanitizePicks(picks);
    const kept = Object.fromEntries(Object.entries(current).filter(([key]) => !groupById(key) || LEFT_ALONE.has(key)));
    let next: Picks = {};
    for (const group of GROUPS) {
        if (LEFT_ALONE.has(group.id)) continue;
        if (EXTRA_GROUPS.has(group.id) && random() >= EXTRA_GROUP_ODDS) continue;
        const avoided = AVOIDED[group.id];
        const options = group.options.filter(([value]) => value !== 'None' && !avoided?.has(value));
        if (!options.length) continue;
        const human = group.id === 'character_type' && random() < HUMAN_FIRST_ODDS;
        next = changePick(next, group.id, human ? 'Human' : options[roll(options.length)][0]);
    }
    return sanitizePicks({ ...kept, ...next });
}

// Everything in the studio prompt except the character head.
export function buildDirection({ mode = 'portrait', motionId = '', scene = '' }: { mode?: 'portrait' | 'motion'; motionId?: string; scene?: string }): string {
    const motion = MOTIONS.find((m) => m.id === motionId);
    return [
        mode === 'motion' ? 'vertical short-form creator video, full body visible at the opening, consistent identity throughout the shot' : 'full-body editorial creator portrait, complete silhouette visible, character-sheet clarity',
        motion?.phrase,
        String(scene || '').trim(),
    ].filter(Boolean).join(', ');
}

export const buildStudioPrompt = (args: { picks: Picks; mode?: 'portrait' | 'motion'; motionId?: string; scene?: string }): string => buildCharacterPrompt(buildDirection(args), args.picks);

export const optionLabel = (groupId: string, value: string): string => groupById(groupId)?.options.find(([v]) => v === value)?.[2] ?? value;
