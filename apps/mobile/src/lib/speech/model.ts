import { isSupported, kindOf, type CatalogModel } from '../media';
// /api/catalog publicModelId leaves this unsuffixed id unchanged; fetchCatalog converts supplier tags back.
export const SPEECH_MODEL_ID = 'minimax-speech-2.6-hd';
export function speechModel(models: readonly CatalogModel[]): CatalogModel | null {
    return models.find(model => model.id === SPEECH_MODEL_ID && isSupported(model)
        && kindOf(model.modality) === 'audio' && Number.isFinite(model.credits) && model.credits >= 0) ?? null;
}
