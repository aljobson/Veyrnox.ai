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
    return { ...common(a.modelId, models), id: AUDIO_PREFIX + a.id, title: a.name, category: a.category, modality: 'text-to-audio', prompt: a.prompt, posterUrl: null };
}

// The catalog price of the template's model, as Create > Templates shows it ('' while the catalog has not arrived).
export function priceOfDirect(p: Preset, models: ReadonlyMap<string, CatalogModel>): string {
    const model = models.get(p.modelId);
    const credits = model ? priceLines(model)[0]?.credits : undefined;
    return typeof credits === 'number' && credits > 0 ? plural('library.cost', credits) : '';
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
