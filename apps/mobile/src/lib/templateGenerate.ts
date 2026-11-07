import { optionsFor, resolveAudio, resolveResolution, settingsInputs } from './createOptions';
import type { SubmitRequest } from './generationSubmit';
import { estimateCredits, kindOf, textInput, type CatalogModel } from './media';
import type { Preset } from './presets';
import { GENERATION_PROMPT_MAX } from './promptLimits';
import { slotsFor, type GenerationReference, type Slot } from './sources';

// ADR-0120 amendment 1: a template that needs no media can be generated from its own page. Everything it sends is built
// here from the same pieces Create uses (createGenerationSubmit, settingsInputs, estimateCredits), so the price, the
// ceiling, the keys and the refund path are Create's. A template whose only media is one photo takes it on its own page
// too (start image + the rights tick); a template that needs a video, audio or a described voice still goes through Create.

// An exact prompt that points at a source video we cannot supply cannot reproduce its preview: the
// model never sees the footage and invents a different clip. Such a template is inspiration only (web: templateSourceBlock).
const UNSUPPORTED_SOURCE_ISSUES = ['reference-video-not-supported'];
export function sourceUnsupported(preset: Pick<Preset, 'sourcePromptOrigin' | 'sourcePromptIssues'> | null | undefined): boolean {
    return preset?.sourcePromptOrigin === 'community-source-exact' && (preset.sourcePromptIssues ?? []).some(issue => UNSUPPORTED_SOURCE_ISSUES.includes(issue));
}

/** The photo slot when the model's one required media is a single start image, else null. */
export function photoSlot(model: CatalogModel | undefined): Slot | null {
    const required = model ? slotsFor(model).filter(slot => slot.required) : [];
    // A model that wants two or more start images is not a one-photo template.
    const minFiles = (model?.capabilities?.media?.image as { minFiles?: number } | undefined)?.minFiles;
    return required.length === 1 && required[0].slot === 'image' && !(Number(minFiles) > 1) ? required[0] : null;
}

const NON_PHOTO_NEEDS = /\b(video|audio|voice|clip|recording)\b/i;

/** Why a template cannot generate from its own page, or null when it can. With { photo: true } the page can take one photo. */
export function inlineBlockReason(preset: Preset, model: CatalogModel | undefined, { photo = false }: { photo?: boolean } = {}): 'media' | 'options' | 'unavailable' | null {
    if (!preset.available || !model) return 'unavailable';
    const kind = kindOf(model.modality);
    if (kind !== 'image' && kind !== 'video') return 'options';
    const photoOk = photo && !!photoSlot(model) && !NON_PHOTO_NEEDS.test(preset.needs ?? '');
    if (!photoOk && (preset.needs || slotsFor(model).some(slot => slot.required))) return 'media';
    const options = optionsFor(model);
    if (textInput(model)?.key !== 'prompt' || options.voice || options.audioLength) return 'options';
    return null;
}

// A start image only fixes the first frame; this line keeps the person in it as the lead for the whole clip.
const PHOTO_CHARACTER_LINE = 'The person in the attached photo is the main character; keep their face, hair and clothing the same throughout.';
function withPhotoLine(text: string, hasPhoto: boolean): string {
    const joined = `${text}\n\n${PHOTO_CHARACTER_LINE}`;
    return hasPhoto && joined.length <= GENERATION_PROMPT_MAX ? joined : text;
}

/** The request Create would send for this template with nothing, or one start photo, attached and no extra settings. */
export function templateRequest(preset: Preset, model: CatalogModel, choice: { prompt: string; aspect: string | null; duration: number | null; references?: readonly GenerationReference[]; sourceRights?: boolean; templateClip?: string }): SubmitRequest {
    if (choice.templateClip === preset.id) return { analyticsKind: 'video', modelId: model.id, templateClip: preset.id, prompt: '', durationSeconds: 5, confirmedCredits: model.credits, references: choice.references ?? [], sourceRights: true };
    const options = optionsFor(model);
    const exact = preset.sourcePromptOrigin === 'community-source-exact' && preset.sourcePrompt ? preset.sourcePrompt : preset.prompt;
    const uneditedExact = preset.sourcePromptOrigin === 'community-source-exact' && choice.prompt === exact;
    const video = kindOf(model.modality) === 'video';
    const references = choice.references ?? [];
    return {
        analyticsKind: kindOf(model.modality),
        modelId: model.id,
        // Like Create: the recipe's own words go unchanged, anything the person edited is trimmed.
        prompt: withPhotoLine(choice.prompt === exact ? choice.prompt : choice.prompt.trim(), references.length > 0 && !uneditedExact),
        confirmedCredits: estimateCredits(model, video ? choice.duration : null),
        durationSeconds: video ? choice.duration : null,
        references,
        sourceRights: references.length ? choice.sourceRights === true : undefined,
        textKey: 'prompt',
        extraInputs: settingsInputs(options, {
            seed: '', negative: '', aspect: choice.aspect,
            resolution: resolveResolution(model, options, null), audio: resolveAudio(model, options, null),
        }),
        // The gateway takes a template id only on the template's own model.
        preset: model.id === preset.modelId ? preset.id : undefined,
    };
}
