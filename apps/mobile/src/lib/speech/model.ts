import { isSupported, kindOf, type CatalogModel } from '../media';
// @ts-ignore shared plain JavaScript
import { SPEECH_MODEL_IDS as supportedIds } from '../../../../../lib/speechInputs.js';
export const SPEECH_MODEL_ID = 'minimax-speech-2.6-hd';
export const SPEECH_MODEL_IDS: readonly string[] = supportedIds;
export const isSpeechModelId = (id: string) => SPEECH_MODEL_IDS.includes(id);
export function speechModels(models: readonly CatalogModel[]): CatalogModel[] {
    return SPEECH_MODEL_IDS.flatMap(id => models.filter(model => model.id === id && isSupported(model)
        && kindOf(model.modality) === 'audio' && Number.isFinite(model.credits) && model.credits >= 0));
}
// Existing callers retain their MiniMax preference; Qwen can also be the only available speech model.
export function speechModel(models: readonly CatalogModel[], id?: string): CatalogModel | null {
    const supported = speechModels(models);
    return (id ? supported.find(model => model.id === id) : supported[0]) ?? null;
}
