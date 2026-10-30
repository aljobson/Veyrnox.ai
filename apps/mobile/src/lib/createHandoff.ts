import type { OptionValues } from '../components/CreateOptions';
import { sanitizeCinema, type Cinema } from './cinemaCamera';
import { sanitizePicks, type Picks } from './oddlingsBuilder';
import { imageCount, optionsFor, resolveAudio, resolveResolution, seedIsInvalid } from './createOptions';
import { kindOf, textInput, type CatalogModel } from './media';
import { slotsFor, type GenerationReference } from './sources';
import { nearestAspect, parseRatio } from './templateHandoff';
import { stageCreativeSourceHandoff, type CreativeSourceHandoff } from './creativeSourceHandoff';

export interface FormSnapshot {
    opts: OptionValues;
    cameraOn: boolean;
    cinema: Cinema;
    characterOn: boolean;
    character: Picks;
}
export function acceptedSettings(model: CatalogModel, saved: FormSnapshot): FormSnapshot {
    const o = optionsFor(model), v = saved.opts, kind = kindOf(model.modality);
    const prompt = textInput(model)?.key === 'prompt';
    return {
        opts: { aspect: nearestAspect(parseRatio(v.aspect), o.aspects), count: imageCount(model, v.count),
            seed: o.seed && !seedIsInvalid(v.seed) ? v.seed : '', negative: o.negativeMax === null ? '' : v.negative.slice(0, o.negativeMax),
            voice: o.voice ? v.voice : '', audioSeconds: o.audioLength && Number(v.audioSeconds) >= o.audioLength.min && Number(v.audioSeconds) <= o.audioLength.max ? v.audioSeconds : '',
            resolution: resolveResolution(model, o, v.resolution), audio: resolveAudio(model, o, v.audio) },
        cameraOn: !!prompt && (kind === 'image' || kind === 'video') && saved.cameraOn, cinema: sanitizeCinema(saved.cinema),
        characterOn: !!prompt && kind === 'image' && saved.characterOn, character: sanitizePicks(saved.character),
    };
}
export function nearestDuration(model: CatalogModel, wanted: number): number | null {
    if (kindOf(model.modality) !== 'video') return null;
    return model.durations.reduce<number | null>((best, n) => best === null || Math.abs(n - wanted) < Math.abs(best - wanted) ? n : best, null) ?? 5;
}
const identity = (ref: GenerationReference) => ref.origin === 'asset' ? `asset:${ref.asset_id}` : `upload:${ref.key}`;
export const referenceKind = (ref: GenerationReference) => ref.slot === 'endImage' ? 'image' : ref.slot;
export function uniqueReferences(refs: readonly GenerationReference[]): GenerationReference[] {
    const seen = new Set<string>();
    return refs.filter(ref => { const id = identity(ref); if (seen.has(id)) return false; seen.add(id); return true; });
}
export function acceptedReferences(model: CatalogModel, refs: readonly GenerationReference[]) {
    const slots = slotsFor(model), result: GenerationReference[] = [];
    let moved = 0;
    for (const ref of uniqueReferences(refs)) {
        const accepts = (slot: typeof slots[number]) => slot.kind === referenceKind(ref) && result.filter(r => r.slot === slot.slot).length < (slot.maxFiles ?? 1);
        const slot = slots.find(s => s.slot === ref.slot && accepts(s)) ?? slots.find(accepts);
        if (!slot || result.filter(r => referenceKind(r) === referenceKind(ref)).length >= 3) continue;
        if (slot.slot !== ref.slot) moved++;
        result.push({ ...ref, slot: slot.slot });
    }
    return { references: result, adjusted: moved + uniqueReferences(refs).length - result.length };
}
export function createHandoff(model: CatalogModel, carry: Readonly<Record<string, string>>, settings: FormSnapshot | undefined,
    refs: readonly GenerationReference[], previous?: Partial<CreativeSourceHandoff>, skipped = 0) {
    const accepted = acceptedReferences(model, refs);
    const recipe = carry.recipe || previous?.recipe || 'attach';
    const sourceHandoff = stageCreativeSourceHandoff({ ...previous, recipe, modelId: model.id, uploaded: {}, fromLibrary: {},
        references: accepted.references, settings: settings ? acceptedSettings(model, settings) : undefined,
        adjusted: accepted.adjusted + skipped, followup: previous?.followup ?? (carry.followup === 'generated-sound' ? carry.followup : undefined) });
    return { pathname: '/create/[modelId]' as const, params: { ...carry, modelId: model.id, recipe, sourceHandoff } };
}
export const skillPromptHref = (skill: string, prompt: string, modelId: string) => ({ pathname: '/chat/skills' as const, params: { skill, prompt, modelId } });
