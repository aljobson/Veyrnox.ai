import { priceLines } from './catalogPages';
import { plural } from './i18n';
import { presetKind } from './explore';
import { isKnownCategory } from './presetCategoryLabel';
import type { AudioTemplate } from './audioTemplates';
import type { ImageTemplate } from './imageTemplates';
import type { CatalogModel } from './media';
import type { Preset } from './presets';

// Explore lists image and audio templates beside video ones. They come from the same two sources as Create > Templates
// (GET /api/templates?kind=image|audio) and are shaped like a Preset only so the one gallery can filter and draw them.
// A colon never occurs in a server preset id, so the prefix says which cards open Create directly with their prompt.
const IMAGE_PREFIX = 'image:';
const AUDIO_PREFIX = 'audio:';
export const isDirectTemplate = (id: string): boolean => id.startsWith(IMAGE_PREFIX) || id.startsWith(AUDIO_PREFIX);

const common = (modelId: string, models: ReadonlyMap<string, CatalogModel>) => ({
    modelId,
    modelName: models.get(modelId)?.name ?? modelId,
    needs: null,
    durationSeconds: null,
    // The price is the catalog's, read in priceOfDirect; nothing here computes one.
    credits: 0,
    available: true,
    isNew: false,
    previewUrl: null,
});

export function imageAsPreset(i: ImageTemplate, models: ReadonlyMap<string, CatalogModel>): Preset {
    return { ...common(i.modelId, models), id: IMAGE_PREFIX + i.id, title: i.name, category: isKnownCategory(i.category) ? i.category : 'OTHER', modality: i.photoRequired ? 'image-to-image' : 'text-to-image', prompt: i.prompt, posterUrl: i.previewUrl };
}

export function audioAsPreset(a: AudioTemplate, models: ReadonlyMap<string, CatalogModel>): Preset {
    return { ...common(a.modelId, models), id: AUDIO_PREFIX + a.id, title: a.name, category: a.category, modality: 'text-to-audio', prompt: a.prompt, posterUrl: a.previewUrl };
}

// The catalog price of the template's model, as Create > Templates shows it ('' while the catalog has not arrived).
export function priceOfDirect(p: Preset, models: ReadonlyMap<string, CatalogModel>): string {
    const model = models.get(p.modelId);
    const credits = model ? priceLines(model)[0]?.credits : undefined;
    return typeof credits === 'number' && credits > 0 ? plural('library.cost', credits) : '';
}

// A direct template whose model the live catalog does not list (switched off, or not supported here) opens a dead end in
// Create, so it is not listed. `null` means the catalog is unknown (not loaded yet, or the fetch failed): nothing is hidden.
// A loaded catalog is authoritative, even an empty one.
export function templatesWithCatalogModel<T extends { readonly modelId: string }>(list: readonly T[], models: ReadonlyMap<string, CatalogModel> | null): T[] {
    return models ? list.filter((item) => models.has(item.modelId)) : [...list];
}

// Every template Explore lists: the video presets, then the image and audio templates whose model the catalog still lists.
export function listedTemplates(presets: readonly Preset[], images: readonly ImageTemplate[], audio: readonly AudioTemplate[], models: ReadonlyMap<string, CatalogModel>, known: ReadonlyMap<string, CatalogModel> | null): Preset[] {
    return [...presets, ...templatesWithCatalogModel(images, known).map((i) => imageAsPreset(i, models)), ...templatesWithCatalogModel(audio, known).map((a) => audioAsPreset(a, models))];
}

// Audio tiles take a whole row and the others sit two across. A full row that lands after one half tile waits until that
// pair is complete, so the grid never leaves a hole. Everything else keeps its order.
export function packFullRows<T>(items: readonly T[], isFullRow: (item: T) => boolean): T[] {
    const packed: T[] = [];
    let waiting: T[] = [];
    let halfRow = false;
    for (const item of items) {
        if (isFullRow(item)) {
            if (halfRow) waiting = [...waiting, item]; else packed.push(item);
            continue;
        }
        packed.push(item);
        halfRow = !halfRow;
        if (!halfRow) { packed.push(...waiting); waiting = []; }
    }
    return [...packed, ...waiting];
}

// "All" shows each kind, not only the biggest list: one of each in turn, every kind keeping its own order.
export function mixKinds(presets: readonly Preset[]): Preset[] {
    const lanes = new Map<string, Preset[]>();
    for (const p of presets) lanes.set(presetKind(p) ?? '', [...(lanes.get(presetKind(p) ?? '') ?? []), p]);
    const rows = [...lanes.values()];
    const mixed: Preset[] = [];
    for (let at = 0; mixed.length < presets.length; at++) for (const row of rows) if (at < row.length) mixed.push(row[at]);
    return mixed;
}
