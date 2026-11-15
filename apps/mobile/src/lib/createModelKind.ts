import { kindOf, type CatalogModel } from './media';
import { slotsFor, type GenerationReference } from './sources';

/** A model that animates a photo to match audio you supply (talking avatar): camera and lens words do nothing for it. */
export function isAudioDriven(model: CatalogModel): boolean {
    return kindOf(model.modality) === 'video' && slotsFor(model).some((slot) => slot.slot === 'audio' && slot.required);
}

/** Adds generated sound to a clip you supply: lens words and "describe the change" do not fit it. */
export function isSoundPass(model: CatalogModel): boolean {
    return model.id === 'mmaudio-v2-video';
}

/** Text to speech: the box holds the words to say, not a description of what to create. */
export function isSpeechModel(model: CatalogModel): boolean {
    return kindOf(model.modality) === 'audio' && /speech|voice|tts|narrat/i.test(`${model.modality} ${model.id}`);
}

/** Labels of the required files that are still missing, in slot order. */
export function missingRequiredSlots(model: CatalogModel, references: readonly Pick<GenerationReference, 'slot'>[], hasStartFile: boolean): string[] {
    return slotsFor(model)
        .filter((slot) => slot.required && !references.some((ref) => ref.slot === slot.slot) && !(slot.slot === 'image' && hasStartFile))
        .map((slot) => slot.label);
}

export type NeedKey = 'create.needs.image' | 'create.needs.video' | 'create.needs.audio' | 'create.needs.prompt';

/** The message naming the first thing Generate is waiting for (a required file of any kind, or the words), or null. */
export function missingNeedKey(model: CatalogModel, references: readonly Pick<GenerationReference, 'slot'>[], hasStartFile: boolean, promptMissing: boolean): NeedKey | null {
    const slot = slotsFor(model).find((s) => s.required && !references.some((ref) => ref.slot === s.slot) && !(s.slot === 'image' && hasStartFile));
    if (slot) return `create.needs.${slot.kind}` as NeedKey;
    return promptMissing ? 'create.needs.prompt' : null;
}
