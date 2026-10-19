import { estimateCredits, kindOf, promptRequired, textInput, type CatalogModel, type Kind } from './media';

// Making an image, video or sound from inside a chat (ADR-0180). A compact version of Create: choose the kind, a model and
// the words, see the price, and the creation starts. Models that need a file (editors, image-to-video) stay in Create, where
// the file is chosen; so do batches, camera and character controls.
export const MEDIA_KINDS: readonly Kind[] = ['image', 'video', 'audio'];
export const MAX_MEDIA_PROMPT = 2000;

// A model the compact composer can buy directly: open, a kind it can show, words only (no required file), and a plain prompt.
export function chatMediaModels(models: readonly CatalogModel[], kind: Kind): CatalogModel[] {
    return models.filter((m) => {
        if (m.gated || kindOf(m.modality) !== kind) return false;
        const media = m.capabilities?.media ?? {};
        if (Object.values(media).some((slot) => slot.required)) return false;
        return textInput(m)?.key === 'prompt' && promptRequired(m);
    });
}

// The cheapest model first, so the default is the least a person can spend; ties break by name.
export function byPrice(models: readonly CatalogModel[]): CatalogModel[] {
    return [...models].sort((a, b) => estimateCredits(a, a.durations[0] ?? null) - estimateCredits(b, b.durations[0] ?? null) || a.name.localeCompare(b.name));
}

export function supportedDuration(model: CatalogModel, wanted: number | null): number | null {
    if (kindOf(model.modality) !== 'video') return null;
    const options = model.durations.length ? model.durations : [5];
    return wanted !== null && options.includes(wanted) ? wanted : options[0];
}

// What the Make button will charge: the catalog price for this model and length. The server prices the request itself and
// refuses a different number (credit_confirmation_mismatch), so this can never overcharge.
export const makePrice = (model: CatalogModel, duration: number | null): number => estimateCredits(model, supportedDuration(model, duration));

export const cleanMediaPrompt = (raw: string): string => raw.trim().slice(0, MAX_MEDIA_PROMPT);

// The same request keeps its key, so a retry after a dropped connection is charged once; a different request gets a new one.
export interface PendingMake {
    readonly signature: string;
    readonly key: string;
}
export function makeKeyFor(previous: PendingMake | null, model: CatalogModel, prompt: string, duration: number | null, make: () => string): PendingMake {
    const signature = `${model.id}|${prompt}|${supportedDuration(model, duration) ?? ''}`;
    return previous && previous.signature === signature ? previous : { signature, key: make() };
}
