import { sanitizeCinema, type Cinema } from './cinemaCamera';
import { sanitizePicks, type Picks } from './oddlingsBuilder';
import { kindOf, type CatalogModel, type Kind } from './media';

// ADR-0153: the web Create page's option set, as pure helpers. The catalog (`capabilities.inputs`) says which
// options a model takes; the server checks each value again against the same record, so this is a form, not a guard.
// Mirrors app/veyrnox/_lib/{generationSettings,imageBatch,freeAllowance,modelTiers,starterModels}.js.

export const SEED_MAX = 2147483647;
export const NEGATIVE_MAX = 2000;
export const IMAGE_COUNTS = [1, 2, 3, 4] as const;

export type Goal = Kind | 'all';
export const GOALS: readonly { readonly goal: Goal; readonly label: string }[] = [
    { goal: 'image', label: 'create.goal.image' },
    { goal: 'video', label: 'create.goal.video' },
    { goal: 'audio', label: 'create.goal.audio' },
    { goal: 'all', label: 'create.goal.all' },
];

export function modelsForGoal(models: readonly CatalogModel[], goal: Goal): CatalogModel[] {
    return models.filter((m) => goal === 'all' || kindOf(m.modality) === goal);
}

export type Tier = 'low' | 'medium' | 'high';
export const TIERS: readonly Tier[] = ['low', 'medium', 'high'];

// Thirds by credit price. Equal prices share a tier, so two models that cost the same never land in different groups.
export function tierById(models: readonly CatalogModel[]): Map<string, Tier> {
    const prices = [...new Set(models.map((m) => m.credits))].sort((a, b) => a - b);
    const third = prices.length / 3;
    const out = new Map<string, Tier>();
    for (const m of models) {
        const rank = prices.indexOf(m.credits);
        out.set(m.id, TIERS[Math.min(2, Math.floor(rank / Math.max(third, 1)))]);
    }
    return out;
}

// tier null shows everything.
export function filterByTier(models: readonly CatalogModel[], tier: Tier | null): CatalogModel[] {
    if (!tier) return [...models];
    const tiers = tierById(models);
    return models.filter((m) => tiers.get(m.id) === tier);
}

type InputRecord = Record<string, { values?: unknown; max?: unknown } | undefined>;
const inputsOf = (model: CatalogModel): InputRecord => (model.capabilities?.inputs ?? {}) as InputRecord;

export interface ModelOptions {
    readonly seed: boolean;
    // Longest negative prompt the model takes, or null when it takes none.
    readonly negativeMax: number | null;
    // Aspect ratios the model accepts, or an empty list when it takes none.
    readonly aspects: readonly string[];
    // Speech models take a voice described in words, and it is required.
    readonly voice: boolean;
    // Audio length in seconds, for the models that let you choose one.
    readonly audioLength: { readonly min: number; readonly max: number; readonly def: number } | null;
    // Output resolutions and audio on/off, for the models that declare them (Seedance 2.0 Fast). The catalog price
    // is flat across every choice (ADR-0027, 2026-10-15), so these never change the credits.
    readonly resolutions: readonly string[];
    readonly audioChoice: boolean;
}

export function optionsFor(model: CatalogModel): ModelOptions {
    const inputs = inputsOf(model);
    const values = inputs.aspect_ratio?.values;
    const neg = inputs.negative_prompt;
    return {
        seed: !!inputs.seed,
        negativeMax: neg ? (typeof neg.max === 'number' ? neg.max : NEGATIVE_MAX) : null,
        aspects: Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [],
        voice: !!inputs.voice_description,
        audioLength: audioLengthOf(model),
        resolutions: resolutionsOf(model),
        audioChoice: audioChoiceOf(model),
    };
}

// Like the web (useCatalog.js): a choice is shown only when the model offers more than one.
function resolutionsOf(model: CatalogModel): string[] {
    const values = inputsOf(model).output_resolution?.values;
    const list = Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
    return list.length > 1 ? list : [];
}

function audioChoiceOf(model: CatalogModel): boolean {
    const values = inputsOf(model).audio_enabled?.values;
    return Array.isArray(values) && values.includes(true) && values.includes(false);
}

const presentationOf = (model: CatalogModel): { resolutionLabel?: unknown; audioIncluded?: unknown } =>
    ((model.capabilities as { presentation?: object } | null)?.presentation ?? {}) as { resolutionLabel?: unknown; audioIncluded?: unknown };

// The choice shown when none was made: the tier the catalog price buys, else the first offered (web: mediaOutputSettings).
export function resolveResolution(model: CatalogModel, o: ModelOptions, wanted: string | null | undefined): string | null {
    if (!o.resolutions.length) return null;
    if (wanted && o.resolutions.includes(wanted)) return wanted;
    const priced = presentationOf(model).resolutionLabel;
    return typeof priced === 'string' && o.resolutions.includes(priced) ? priced : o.resolutions[0];
}

export function resolveAudio(model: CatalogModel, o: ModelOptions, wanted: boolean | null | undefined): boolean | null {
    if (!o.audioChoice) return null;
    if (typeof wanted === 'boolean') return wanted;
    const priced = presentationOf(model).audioIncluded;
    return typeof priced === 'boolean' ? priced : true;
}

export const VOICE_MAX = 500;

// The audio models that let you pick a length declare `duration` as an int range (web: audioDurationConfig).
function audioLengthOf(model: CatalogModel): ModelOptions['audioLength'] {
    if (kindOf(model.modality) !== 'audio') return null;
    const d = (inputsOf(model).duration ?? {}) as { type?: unknown; min?: unknown; max?: unknown; default?: unknown };
    if (d.type !== 'int' || !Number.isInteger(d.min) || !Number.isInteger(d.max) || (d.min as number) > (d.max as number)) return null;
    const min = d.min as number;
    const max = d.max as number;
    const def = Number.isInteger(d.default) && (d.default as number) >= min && (d.default as number) <= max ? (d.default as number) : max;
    return { min, max, def };
}

export const voiceIsMissing = (o: ModelOptions, voice: string): boolean => o.voice && !voice.trim();

// An empty length means the default; anything else must be a whole number inside the range.
export function audioLengthInvalid(o: ModelOptions, value: string): boolean {
    if (!o.audioLength || value === '') return false;
    const n = Number(value);
    return !/^\d+$/.test(value) || n < o.audioLength.min || n > o.audioLength.max;
}

export const hasSettings = (o: ModelOptions): boolean => o.seed || o.negativeMax !== null;
export const hasOutputChoice = (o: ModelOptions): boolean => o.resolutions.length > 0 || o.audioChoice;
export const hasAnyOption = (o: ModelOptions): boolean => hasSettings(o) || o.aspects.length > 0 || o.voice || o.audioLength !== null || hasOutputChoice(o);

// The count control is for image models only, never an Auto Short.
export function takesImageCount(model: CatalogModel): boolean {
    return kindOf(model.modality) === 'image' && !('topic' in inputsOf(model));
}

export function imageCount(model: CatalogModel, count: number): number {
    return takesImageCount(model) && (IMAGE_COUNTS as readonly number[]).includes(count) ? count : 1;
}

export const seedIsInvalid = (seed: string): boolean => seed !== '' && !(/^\d+$/.test(seed) && Number(seed) <= SEED_MAX);

// What to send for the settings: only what the model takes and the person set. An invalid seed is dropped.
export function settingsInputs(
    options: ModelOptions,
    s: { seed: string; negative: string; aspect: string | null; voice?: string; audioSeconds?: string; resolution?: string | null; audio?: boolean | null },
): Record<string, string | number | boolean> {
    const out: Record<string, string | number | boolean> = {};
    if (options.resolutions.length && s.resolution && options.resolutions.includes(s.resolution)) out.output_resolution = s.resolution;
    if (options.audioChoice && typeof s.audio === 'boolean') out.audio_enabled = s.audio;
    if (options.seed && /^\d+$/.test(s.seed) && Number(s.seed) <= SEED_MAX) out.seed = Number(s.seed);
    if (options.negativeMax !== null && s.negative.trim()) out.negative_prompt = s.negative.trim().slice(0, options.negativeMax);
    if (s.aspect && options.aspects.includes(s.aspect)) out.aspect_ratio = s.aspect;
    if (options.voice && s.voice?.trim()) out.voice_description = s.voice.trim().slice(0, VOICE_MAX);
    if (options.audioLength && !audioLengthInvalid(options, s.audioSeconds ?? '')) out.duration = s.audioSeconds ? Number(s.audioSeconds) : options.audioLength.def;
    return out;
}

// A set seed moves by one per image so the images differ, wrapping inside the range the server accepts.
export function inputsForIndex<T extends Record<string, unknown>>(inputs: T, i: number, count: number): T {
    if (count <= 1 || typeof inputs.seed !== 'number') return inputs;
    return { ...inputs, seed: (inputs.seed + i) % (SEED_MAX + 1) };
}

// Credits for a batch once today's free runs are applied: the first `left` images are free, the rest are priced
// from the catalog. The server decides what is really free; this only words the button.
export function batchCost(unit: number, count: number, freeLeft: number): number {
    const free = Math.min(Math.max(0, Math.floor(freeLeft) || 0), count);
    return unit * Math.max(0, count - free);
}

export const freeLeftFor = (left: Readonly<Record<string, number>>, modelId: string): number => {
    const n = left[modelId];
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : 0;
};

// The words of a Create form, kept per account so a closed app does not lose them (cache prefix: wiped on sign-out).
export const SAVED_DRAFT_VERSION = 1;

export interface CreateDraft {
    readonly v: typeof SAVED_DRAFT_VERSION;
    readonly modelId: string;
    readonly prompt: string;
    readonly duration: number | null;
    readonly aspect: string | null;
    readonly count: number;
    readonly seed: string;
    readonly negative: string;
    // Added with the Cinema camera and voice (ADR-0175); a draft saved before them reads back without.
    readonly voice?: string;
    readonly audioSeconds?: string;
    readonly cinemaOn?: boolean;
    readonly cinema?: Cinema;
    // The Character panel (ADR-0176): on or off, and the traits chosen.
    readonly characterOn?: boolean;
    readonly character?: Picks;
}

// A saved draft is read back only if it is well formed and for this model. Files and keys are never saved: a file
// picked on the phone is uploaded again, so nothing private sits in the draft but the words.
export function parseDraft(raw: unknown, modelId: string): CreateDraft | null {
    if (!raw || typeof raw !== 'object') return null;
    const d = raw as Partial<CreateDraft>;
    if (d.v !== SAVED_DRAFT_VERSION || d.modelId !== modelId) return null;
    if (typeof d.prompt !== 'string' || typeof d.seed !== 'string' || typeof d.negative !== 'string' || typeof d.count !== 'number') return null;
    return {
        v: SAVED_DRAFT_VERSION,
        modelId,
        prompt: d.prompt.slice(0, 4000),
        duration: typeof d.duration === 'number' ? d.duration : null,
        aspect: typeof d.aspect === 'string' ? d.aspect : null,
        count: d.count,
        seed: d.seed.slice(0, 10),
        negative: d.negative.slice(0, NEGATIVE_MAX),
        voice: typeof d.voice === 'string' ? d.voice.slice(0, VOICE_MAX) : '',
        audioSeconds: typeof d.audioSeconds === 'string' ? d.audioSeconds.slice(0, 4) : '',
        cinemaOn: d.cinemaOn === true,
        cinema: sanitizeCinema(d.cinema),
        characterOn: d.characterOn === true,
        character: sanitizePicks(d.character),
    };
}

export const draftIsEmpty = (d: Pick<CreateDraft, 'prompt' | 'seed' | 'negative' | 'voice'>): boolean => !d.prompt.trim() && !d.seed && !d.negative.trim() && !d.voice?.trim();
