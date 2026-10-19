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
