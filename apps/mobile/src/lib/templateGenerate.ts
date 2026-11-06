import { optionsFor, resolveAudio, resolveResolution, settingsInputs } from './createOptions';
import type { SubmitRequest } from './generationSubmit';
import { estimateCredits, kindOf, textInput, type CatalogModel } from './media';
import type { Preset } from './presets';
import { slotsFor } from './sources';

// ADR-0120 amendment 1: a template that needs no media can be generated from its own page. Everything it sends is built
// here from the same pieces Create uses (createGenerationSubmit, settingsInputs, estimateCredits), so the price, the
// ceiling, the keys and the refund path are Create's. A template that needs a picture or a described voice still goes
// through Create.

// An exact prompt that points at a source video we cannot supply cannot reproduce its preview: the
// model never sees the footage and invents a different clip. Such a template is inspiration only (web: templateSourceBlock).
const UNSUPPORTED_SOURCE_ISSUES = ['reference-video-not-supported'];
export function sourceUnsupported(preset: Pick<Preset, 'sourcePromptOrigin' | 'sourcePromptIssues'> | null | undefined): boolean {
    return preset?.sourcePromptOrigin === 'community-source-exact' && (preset.sourcePromptIssues ?? []).some(issue => UNSUPPORTED_SOURCE_ISSUES.includes(issue));
}

/** Why a template cannot generate from its own page, or null when it can. */
export function inlineBlockReason(preset: Preset, model: CatalogModel | undefined): 'media' | 'options' | 'unavailable' | null {
    if (!preset.available || !model) return 'unavailable';
    const kind = kindOf(model.modality);
    if (kind !== 'image' && kind !== 'video') return 'options';
    if (preset.needs || slotsFor(model).some(slot => slot.required)) return 'media';
    const options = optionsFor(model);
    if (textInput(model)?.key !== 'prompt' || options.voice || options.audioLength) return 'options';
    return null;
}

/** The request Create would send for this template with nothing attached and no extra settings. */
export function templateRequest(preset: Preset, model: CatalogModel, choice: { prompt: string; aspect: string | null; duration: number | null }): SubmitRequest {
    const options = optionsFor(model);
    const exact = preset.sourcePromptOrigin === 'community-source-exact' && preset.sourcePrompt ? preset.sourcePrompt : preset.prompt;
    const video = kindOf(model.modality) === 'video';
    return {
        analyticsKind: kindOf(model.modality),
        modelId: model.id,
        // Like Create: the recipe's own words go unchanged, anything the person edited is trimmed.
        prompt: choice.prompt === exact ? choice.prompt : choice.prompt.trim(),
        confirmedCredits: estimateCredits(model, video ? choice.duration : null),
        durationSeconds: video ? choice.duration : null,
        references: [],
        textKey: 'prompt',
        extraInputs: settingsInputs(options, {
            seed: '', negative: '', aspect: choice.aspect,
            resolution: resolveResolution(model, options, null), audio: resolveAudio(model, options, null),
        }),
        // The gateway takes a template id only on the template's own model.
        preset: model.id === preset.modelId ? preset.id : undefined,
    };
}
