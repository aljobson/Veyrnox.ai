import { isSupported, kindOf, promptRequired, textInput, type CatalogModel, type Job, type Kind } from './media';
import type { Preset } from './presets';

// The Explore tab (N4): what to show and where each tap goes. The prices and models come from the server;
// nothing here computes one.

export const ALL_CATEGORIES = 'ALL';

// "All", then each category once, in the order the server sent them.
export function categoriesOf(presets: readonly Preset[]): string[] {
    return [ALL_CATEGORIES, ...new Set(presets.map((p) => p.category))];
}

export function filterByCategory(presets: readonly Preset[], category: string): Preset[] {
    return category === ALL_CATEGORIES ? [...presets] : presets.filter((p) => p.category === category);
}

export interface PickUp {
    readonly kind: 'making' | 'latest';
    readonly job: Job;
}

// Something still being made comes first; otherwise the latest finished creation that still has its file.
// The jobs list is newest first.
export function pickUp(jobs: readonly Job[]): PickUp | null {
    const making = jobs.find((j) => j.state === 'queued' || j.state === 'running');
    if (making) return { kind: 'making', job: making };
    const latest = jobs.find((j) => j.state === 'succeeded' && j.has_asset);
    return latest ? { kind: 'latest', job: latest } : null;
}

export function recentCreations(jobs: readonly Job[], count: number): Job[] {
    return jobs.filter((j) => j.state === 'succeeded' && j.has_asset).slice(0, count);
}

// The prompt box makes one thing from words alone, so the model must take a plain prompt and need no file.
export function firstModelFor(catalog: readonly CatalogModel[], kind: Kind): CatalogModel | null {
    return catalog.find((m) => kindOf(m.modality) === kind && isSupported(m) && promptRequired(m) && textInput(m)?.key === 'prompt') ?? null;
}

const MAX_PROMPT = 4000;

export const promptHref = (modelId: string, prompt: string) =>
    ({ pathname: '/create/[modelId]', params: { modelId, prompt: prompt.trim().slice(0, MAX_PROMPT) } }) as const;

// The collage: filter by what is being made, then by category, then by words.
export const ALL_TYPES = 'all';
export type TypeFilter = typeof ALL_TYPES | Kind;

export const presetKind = (p: Preset): Kind | null => kindOf(p.modality);

const TYPE_ORDER: readonly Kind[] = ['image', 'video', 'audio'];

// The type chips that have at least one template, in a fixed order.
export function typesPresent(presets: readonly Preset[]): Kind[] {
    const found = new Set(presets.map(presetKind));
    return TYPE_ORDER.filter((k) => found.has(k));
}

const ofType = (presets: readonly Preset[], type: TypeFilter) => (type === ALL_TYPES ? [...presets] : presets.filter((p) => presetKind(p) === type));

// The category chips depend on the type chosen: only the categories that type has.
export const categoriesFor = (presets: readonly Preset[], type: TypeFilter): string[] => categoriesOf(ofType(presets, type));

export interface CollageQuery {
    readonly type: TypeFilter;
    readonly category: string;
    readonly query: string;
}

const norm = (s: string) => s.trim().toLowerCase();

export function filterPresets(presets: readonly Preset[], q: CollageQuery): Preset[] {
    const words = norm(q.query);
    return filterByCategory(ofType(presets, q.type), q.category).filter((p) => !words || norm(p.title).includes(words) || norm(p.prompt).includes(words));
}

// Two columns for the masonry, alternating so the order reads left to right, top to bottom.
export function splitColumns<T>(items: readonly T[]): [T[], T[]] {
    const left: T[] = [];
    const right: T[] = [];
    items.forEach((item, i) => (i % 2 === 0 ? left : right).push(item));
    return [left, right];
}
