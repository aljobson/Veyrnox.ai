import { audioLengthInvalid, optionsFor, seedIsInvalid, voiceIsMissing } from './createOptions';
import { slotsFor, type GenerationReference } from './sources';
import { estimateCredits, kindOf, promptRequired, textInput, type CatalogModel, type Kind } from './media';
import { GENERATION_PROMPT_MAX } from './promptLimits';

export const MEDIA_KINDS: readonly Kind[] = ['image', 'video', 'audio'];
export const MAX_MEDIA_PROMPT = GENERATION_PROMPT_MAX;

// File-driven models share Create's source controls; topic/plan-only models stay in Create.
export function chatMediaModels(models: readonly CatalogModel[], kind: Kind): CatalogModel[] {
    return models.filter(m => !m.gated && kindOf(m.modality) === kind && textInput(m)?.key === 'prompt');
}

export function makeReady(model: CatalogModel, prompt: string, references: readonly GenerationReference[], rights: boolean,
    uploading: boolean, opts: { seed: string; voice: string; audioSeconds: string }): boolean {
    const options = optionsFor(model);
    return !uploading && (!references.length || rights)
        && slotsFor(model).every(slot => {
            const count = references.filter(ref => ref.slot === slot.slot).length;
            return (!slot.required || count > 0) && count <= (slot.maxFiles ?? 1);
        })
        && (!promptRequired(model) || !!prompt.trim()) && !seedIsInvalid(opts.seed)
        && !voiceIsMissing(options, opts.voice) && !audioLengthInvalid(options, opts.audioSeconds);
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

export const cleanMediaPrompt = (raw: string, max = MAX_MEDIA_PROMPT): string => raw.trim().slice(0, max);
