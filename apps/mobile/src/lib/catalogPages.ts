import { estimateCredits, kindOf, type CatalogModel } from './media';

// The read-only Models and Pricing screens (parity P7). Prices are the catalogue's own, in credits: nothing is
// computed here beyond the display estimate the Create screen already uses, and nothing links to buying credits.
export type Kind = 'image' | 'video' | 'audio' | 'other';
export const KIND_ORDER: readonly Kind[] = ['image', 'video', 'audio', 'other'];

export interface Group {
    readonly kind: Kind;
    readonly models: readonly CatalogModel[];
}

// Cheapest first inside a group, then by name; empty groups are left out.
export function groupModels(models: readonly CatalogModel[]): Group[] {
    return KIND_ORDER.map((kind) => ({
        kind,
        models: models
            .filter((m) => (kindOf(m.modality) ?? 'other') === kind)
            .slice()
            .sort((a, b) => a.credits - b.credits || a.name.localeCompare(b.name)),
    })).filter((g) => g.models.length > 0);
}

// Credits shown for a model: per image or clip, with each length for video.
export function priceLines(model: CatalogModel): { readonly seconds: number | null; readonly credits: number }[] {
    if (kindOf(model.modality) === 'video' && model.durations.length > 0) {
        return model.durations.map((seconds) => ({ seconds, credits: estimateCredits(model, seconds) }));
    }
    return [{ seconds: null, credits: estimateCredits(model, null) }];
}

// What a model needs besides words, from its catalogue entry.
export function needs(model: CatalogModel): string[] {
    return Object.entries(model.capabilities?.media ?? {})
        .filter(([, slot]) => slot.required)
        .map(([key, slot]) => slot.label ?? key);
}
