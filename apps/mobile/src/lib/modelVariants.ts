import type { CatalogModel } from './media';

// Mirror of app/veyrnox/_lib/modelVariants.js (the web Create chip). fal's Kling 3.0 image-to-video has no resolution
// field (ADR-0350), so Standard (720p class) and Pro (1080p class) are two catalog models, each priced by its own row.
const GROUPS: ReadonlyArray<ReadonlyArray<{ readonly label: string; readonly id: string }>> = [
    [{ label: '720p', id: 'kling-3.0-standard-i2v' }, { label: '1080p', id: 'kling-3.0-i2v' }],
];

export interface ResolutionVariant { readonly label: string; readonly model: CatalogModel }

/** The resolution choices for a model, lowest first, or [] when it has none or its counterpart is not in the live catalog. */
export function resolutionVariants(modelId: string | undefined, catalog: readonly CatalogModel[]): readonly ResolutionVariant[] {
    const group = GROUPS.find((variants) => variants.some((variant) => variant.id === modelId));
    if (!group) return [];
    const present = group.flatMap((variant) => {
        const model = catalog.find((item) => item.id === variant.id);
        return model ? [{ label: variant.label, model }] : [];
    });
    return present.length > 1 ? present : [];
}
