import { ApiError } from './api';
import { isSupported, type CatalogModel } from './media';
import { generationMessage, type SubmitRequest } from './generationSubmit';
import { t } from './i18n';

export const FACE_IDS = ['face-retouch', 'face-enhance', 'face-relight', 'face-makeup', 'face-age'] as const;
// /api/catalog returns active rows only. No staged fallback and no cached catalog here.
export function faceFilters(models: readonly CatalogModel[]): CatalogModel[] {
    return FACE_IDS.flatMap(id => models.filter(m => m.id === id && isSupported(m)));
}
export type FaceValues = Record<string, string | number | boolean>;
const ENUMS: Record<string, readonly string[]> = {
    makeup_style: ['natural', 'glamorous', 'smoky_eyes', 'bold_lips', 'no_makeup', 'remove_makeup', 'dramatic', 'bridal', 'professional', 'korean_style', 'artistic'],
    intensity: ['light', 'medium', 'heavy', 'dramatic'],
};
export function faceSelectors(model: CatalogModel) {
    const caps = (model.capabilities?.inputs ?? {}) as Record<string, { type?: string; values?: string[]; min?: number; max?: number }>;
    return {
        enums: Object.entries(ENUMS).flatMap(([key, allowed]) => caps[key]?.type === 'enum' ? [{ key, values: (caps[key].values ?? []).filter(v => allowed.includes(v)) }] : []),
        age: caps.target_age?.type === 'int' ? { min: Math.max(18, caps.target_age.min ?? 18), max: Math.min(100, caps.target_age.max ?? 100) } : null,
        identity: caps.preserve_identity?.type === 'bool',
    };
}
export function faceDefaults(model: CatalogModel): FaceValues {
    const selectors = faceSelectors(model);
    const values: FaceValues = {};
    for (const choice of selectors.enums) {
        const preferred = choice.key === 'makeup_style' ? 'natural' : 'medium';
        const value = choice.values.includes(preferred) ? preferred : choice.values[0];
        if (value) values[choice.key] = value;
    }
    if (selectors.age) values.target_age = Math.min(selectors.age.max, Math.max(selectors.age.min, 30));
    if (selectors.identity) values.preserve_identity = true;
    return values;
}
export function faceInputs(model: CatalogModel, values: FaceValues): FaceValues {
    const selectors = faceSelectors(model);
    const inputs: FaceValues = {};
    for (const { key, values: allowed } of selectors.enums) {
        if (values[key] === undefined) continue;
        if (!allowed.includes(String(values[key]))) throw new ApiError(400, 'invalid_inputs');
        inputs[key] = values[key];
    }
    if (selectors.age && values.target_age !== undefined) {
        const age = Number(values.target_age);
        if (!Number.isInteger(age) || age < selectors.age.min || age > selectors.age.max) throw new ApiError(400, 'invalid_inputs');
        inputs.target_age = age;
    }
    if (selectors.identity && typeof values.preserve_identity === 'boolean') inputs.preserve_identity = values.preserve_identity;
    return inputs;
}
export function faceRequest(model: CatalogModel, source: string, prompt: string, values: FaceValues, checked: boolean): SubmitRequest {
    if (!checked) throw new ApiError(400, 'consent_required');
    if (!source || !faceFilters([model]).length || (model.id === 'face-relight' && !prompt.trim())) throw new ApiError(400, 'invalid_inputs');
    return { modelId: model.id, prompt: model.id === 'face-relight' ? prompt.trim() : '', durationSeconds: null, confirmedCredits: model.credits, sources: [{ key: source, slot: 'image' }], extraInputs: faceInputs(model, values), sourceRights: true };
}
export function comparisonUri(view: 'before' | 'after', original: string, result: string): string {
    return view === 'before' ? original : result;
}

// Face filters has additional guidance; Create retains its original error wording.
export function faceFilterMessage(err: unknown): string {
    if (err instanceof ApiError) {
        switch (err.code) {
            case 'consent_required': return t('faceFilters.consentRequired');
            case 'upload_admission_unavailable': return t('faceFilters.uploadPaused');
            case 'provider_moderation':
            case 'provider_input_rejected':
            case 'provider_submit_failed': return t('faceFilters.refused');
        }
    }
    return generationMessage(err);
}

const UPLOAD_REASONS: Readonly<Record<string, string>> = {
    upload_too_large: 'faceFilters.upload.tooLarge',
    upload_type_not_allowed: 'faceFilters.upload.type',
    upload_type_mismatch: 'faceFilters.upload.typeMismatch',
    upload_size_required: 'faceFilters.upload.unreadable',
    upload_unreadable: 'faceFilters.upload.unreadable',
    upload_failed: 'faceFilters.upload.failed',
    upload_check_unavailable: 'faceFilters.upload.unavailable',
    upload_reservation_unavailable: 'faceFilters.upload.unavailable',
    upload_id_invalid: 'faceFilters.upload.failed',
    upload_cancelled: 'faceFilters.upload.cancelled',
    upload_budget_exceeded: 'faceFilters.upload.busy',
    too_many_pending_uploads: 'faceFilters.upload.busy',
    source_not_found: 'faceFilters.upload.expired',
    source_type_unsupported: 'faceFilters.upload.type',
    source_slot_invalid: 'faceFilters.upload.sourceMismatch',
    source_key_invalid: 'faceFilters.upload.sourceMismatch',
    source_asset_invalid: 'faceFilters.upload.sourceMismatch',
    source_unreadable: 'faceFilters.upload.unreadable',
    source_size_unknown: 'faceFilters.upload.unreadable',
    source_length_unknown: 'faceFilters.upload.unreadable',
    source_not_admitted: 'faceFilters.upload.notAdmitted',
};
export function faceFilterUploadMessage(err: ApiError): string {
    const key = UPLOAD_REASONS[err.code];
    return t('faceFilters.uploadRejected', { reason: key ? t(key) : err.code });
}
