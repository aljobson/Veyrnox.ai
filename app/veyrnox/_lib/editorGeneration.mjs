import { generationFileProblem } from './editorGenerationUploads.mjs';
import { generationSlotKind, generationMimeTypes } from '../../../lib/generationSourceSlots.mjs';
export function generationQuote(model, duration) {
    if (!model || !Number.isInteger(model.credits) || model.credits < 0) return null;
    if (generationAvatarSupported(model)) return model.credits;
    if (model.kind === 'video' && (!Number.isFinite(duration) || duration <= 0 || !model.durations?.includes(duration))) return null;
    return model.credits * (model.kind === 'video' ? Math.ceil(duration / 5) : 1);
}
export function generationInputs(model, { prompt, duration, aspect, voice }) {
    const avatar = generationAvatarSupported(model), separation = generationSeparationSupported(model);
    if (!model || model.isEdit || model.takesPlan || model.takesTopic || (!model.takesPrompt && !avatar && !separation)) return { error: 'Choose a supported generation model.' };
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
export function generationSeparationSupported(model) {
    return commonSupported(model) && model.kind === 'audio' && !model.isSpeech && !model.takesPrompt && model.id === 'demucs-stems' &&
        model.media?.audio?.required === true && model.media.audio.maxSeconds === 120 && Object.keys(model.media).length === 1 &&
        Array.isArray(model.outputStems) && model.outputStems.join(',') === 'vocals,drums,bass,other,guitar,piano';
}
export function generationMovementSupported(model) {
    return generationModelSupported(model) && model.kind === 'video' && !model.isSpeech &&
        model.media?.image?.required === true && Object.keys(model.media).every(slot => ['image','endImage'].includes(slot));
}
export const CAMERA_MOVEMENTS = Object.freeze([
    { id: 'push-in', label: 'Push in', direction: 'Move the camera forward toward the subject.' },
    { id: 'pull-out', label: 'Pull out', direction: 'Move the camera backward, revealing more of the scene.' },
    { id: 'pan-left', label: 'Pan left', direction: 'Pan the camera smoothly to the left.' },
    { id: 'pan-right', label: 'Pan right', direction: 'Pan the camera smoothly to the right.' },
    { id: 'orbit-left', label: 'Orbit left', direction: 'Orbit the camera to the left around the subject.' },
    { id: 'orbit-right', label: 'Orbit right', direction: 'Orbit the camera to the right around the subject.' },
    { id: 'tilt-up', label: 'Tilt up', direction: 'Tilt the camera upward through the scene.' },
    { id: 'tilt-down', label: 'Tilt down', direction: 'Tilt the camera downward through the scene.' },
    { id: 'locked', label: 'Locked camera', direction: 'Keep the camera fixed while the subject moves naturally.' },
]);
export const MOVEMENT_PACES = Object.freeze([
    { id: 'gentle', label: 'Gentle', direction: 'Use subtle, gradual movement.' },
    { id: 'steady', label: 'Steady', direction: 'Use continuous, even-paced movement.' },
    { id: 'fast', label: 'Fast', direction: 'Use brisk, smooth movement without sudden cuts.' },
]);
export function generationMovementPrompt(model, { prompt, movement, pace }) {
    if (!generationMovementSupported(model) || !Number.isInteger(model.promptMax) || model.promptMax < 1) return { error: 'Choose an available image-to-video model.' };
    const camera = CAMERA_MOVEMENTS.find(item => item.id === movement), speed = MOVEMENT_PACES.find(item => item.id === pace);
    if (!camera || !speed) return { error: 'Choose a camera movement and pace.' };
    if (typeof prompt !== 'string' || !prompt.trim()) return { error: 'Describe the scene and subject movement.' };
    const composed = `${prompt.trim()}\n\nCamera direction: ${camera.direction} ${speed.direction} Start from the supplied image. Preserve the subject and scene identity. Use one continuous shot.`;
    if (composed.length > model.promptMax) return { error: `Shorten the scene description; the complete direction exceeds ${model.promptMax} characters.` };
    return { prompt: composed };
}
export function generationModelsForMode(models,mode = 'media') {
    return models.filter(model => mode === 'separation' ? generationSeparationSupported(model) : mode === 'avatar' ? generationAvatarSupported(model) : mode === 'movement' ? generationMovementSupported(model) : generationModelSupported(model) && (mode !== 'voiceover' || model.isSpeech));
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
    const media = model?.media || {}, assets = [], uploads = [];
    if (Object.keys(media).length > 2 || Object.keys(media).some(slot => !generationSlotKind(slot))) return { error: 'Choose a supported generation model.' };
    for (const [slot,spec] of Object.entries(media)) {
        const selected = sources?.[slot], label = generationSourceLabel(model,slot);
        if (!selected) { if (spec.required) return { error: `Choose the ${label.toLowerCase()}.` }; continue; }
        if (selected.file) {
            const problem = generationFileProblem(slot,selected.file);
            if (problem || typeof selected.localId !== 'string' || !selected.localId) return { error: problem || 'Choose the source again.' };
            uploads.push({ slot,localId:selected.localId,file:selected.file,mimeType:selected.mimeType }); continue;
        }
        if (typeof selected.assetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(selected.assetId) || !generationMimeTypes(generationSlotKind(slot)).includes(selected.mimeType)) return { error: `Choose a supported ${generationSlotKind(slot)} from your Library for ${label.toLowerCase()}.` };
        assets.push({ asset_id: selected.assetId, slot });
    }
    if ((assets.length || uploads.length) && consent !== true) return { error: 'Confirm the source permission statement.' };
    return { assets,...(uploads.length ? { uploads } : {}) };
}
