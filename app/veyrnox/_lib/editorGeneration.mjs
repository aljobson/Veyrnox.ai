import { generationSlotKind, generationMimeTypes } from '../../../lib/generationSourceSlots.mjs';
export function generationQuote(model, duration) {
    if (!model || !Number.isInteger(model.credits) || model.credits < 0) return null;
    if (generationAvatarSupported(model)) return model.credits;
    if (model.kind === 'video' && (!Number.isFinite(duration) || duration <= 0 || !model.durations?.includes(duration))) return null;
    return model.credits * (model.kind === 'video' ? Math.ceil(duration / 5) : 1);
}
export function generationInputs(model, { prompt, duration, aspect, voice }) {
    const avatar = generationAvatarSupported(model);
    if (!model || model.isEdit || model.takesPlan || model.takesTopic || (!model.takesPrompt && !avatar)) return { error: 'Choose a supported generation model.' };
    if (model.takesPrompt && (typeof prompt !== 'string' || !prompt.trim() || prompt.trim().length > model.promptMax)) return { error: 'Enter a prompt within this model’s limit.' };
    if (model.kind === 'video' && !avatar && !model.durations.includes(duration)) return { error: 'Choose a supported duration.' };
    if (model.takesVoice && (typeof voice !== 'string' || !voice.trim() || voice.trim().length > 500)) return { error: 'Describe the voice in up to 500 characters.' };
    const inputs = model.takesPrompt ? { prompt: prompt.trim() } : {};
    if (model.kind === 'video' && !avatar) inputs.duration_seconds = duration;
    if (model.aspects?.length) { if (!model.aspects.includes(aspect)) return { error: 'Choose a supported shape.' }; inputs.aspect_ratio = aspect; }
    if (model.takesVoice) inputs.voice_description = voice.trim();
    return { inputs };
}

/** Keep provider-specific frame names out of the editor while exposing supported slot semantics. */
function commonSupported(model) {
    return !!model && !model.gated && !model.isEdit && !model.takesTopic && !model.takesPlan && Object.keys(model.media || {}).length <= 2 && Object.keys(model.media || {}).every(slot => !!generationSlotKind(slot));
}
export function generationModelSupported(model) { return commonSupported(model) && !!model.takesPrompt; }
export function generationAvatarSupported(model) {
    if (!commonSupported(model) || model.kind !== 'video' || model.isSpeech) return false;
    const media = model.media || {}, source = media.image || media.video;
    return Object.keys(media).length === 2 && media.audio?.required === true && source?.required === true &&
        Number.isFinite(media.audio.maxSeconds) && media.audio.maxSeconds > 0 &&
        (!media.video || (Number.isFinite(media.video.maxSeconds) && media.video.maxSeconds > 0));
}
export function generationModelsForMode(models,mode = 'media') {
    return models.filter(model => mode === 'avatar' ? generationAvatarSupported(model) : generationModelSupported(model) && (mode !== 'voiceover' || model.isSpeech));
}
export function generationSourceLabel(model,slot) {
    if (model?.media?.[slot]?.label) return model.media[slot].label;
    if (generationAvatarSupported(model)) return slot === 'image' ? 'Avatar photo' : slot === 'video' ? 'Source video' : 'Speech audio';
    return `${generationSlotKind(slot)} source`;
}
export function generationPromptHelp(model) {
    const limit = model?.promptMax || 2000;
    if (['elevenlabs-dialogue','elevenlabs-dialogue-kie'].includes(model?.id)) return `Use one Name: line per speaker, up to four speakers and ${limit} characters. Existing model voices apply.`;
    if (model?.isSpeech) return `Up to ${limit} spoken characters. Existing model voices and settings apply.`;
    return null;
}

export function generationSources(model, sources, consent) {
    const media = model?.media || {}, assets = [];
    if (Object.keys(media).length > 2 || Object.keys(media).some(slot => !generationSlotKind(slot))) return { error: 'Choose a supported generation model.' };
    for (const [slot,spec] of Object.entries(media)) {
        const selected = sources?.[slot], label = generationSourceLabel(model,slot);
        if (!selected) { if (spec.required) return { error: `Choose the ${label.toLowerCase()}.` }; continue; }
        if (typeof selected.assetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected.assetId) || !generationMimeTypes(generationSlotKind(slot)).includes(selected.mimeType)) return { error: `Choose a supported ${generationSlotKind(slot)} from your Library for ${label.toLowerCase()}.` };
        assets.push({ asset_id: selected.assetId, slot });
    }
    if (assets.length && consent !== true) return { error: 'Confirm the source permission statement.' };
    return { assets };
}
