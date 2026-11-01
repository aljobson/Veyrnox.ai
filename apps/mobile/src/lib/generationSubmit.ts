import { getCacheUser } from './appCache';
import * as Crypto from 'expo-crypto';
import { CONSENT_DECLINED_MESSAGE } from './aiConsent';
import { ApiError, type ApiClient } from './api';
import { OFFLINE_PAID_MESSAGE, OfflineError } from './network';
import { inputsForIndex } from './createOptions';
import { mediaApi, type GenerationRequest } from './media';
import { t } from './i18n';

export type SubmitRequest = Omit<GenerationRequest, 'idempotencyKey'>;

// One lifecycle per mounted form. An ambiguous response retains every key, including
// earlier successful batch items. A successful run or an explicit reset starts afresh.
export function createGenerationSubmit() {
    let pending: { signature: string; keys: string[] } | null = null;
    let running = false;
    let epoch = 0;
    return {
        reset() { pending = null; epoch++; },
        async run(api: ApiClient, request: SubmitRequest, count = 1, onStarted?: (count: number) => void, onJob?: (jobId: string, index: number) => void) {
            if (running) throw new ApiError(409, 'submission_in_progress');
            // The signature now covers the whole request, including price and explicit rights, plus batch count.
            const signature = JSON.stringify({ ...request, count });
            const keys = pending?.signature === signature ? pending.keys : Array.from({ length: count }, () => Crypto.randomUUID());
            pending = { signature, keys };
            running = true;
            const generation = epoch;
            const owner = getCacheUser();
            let first: string | null = null;
            try {
                for (let i = 0; i < count; i++) {
                    if (generation !== epoch || owner !== getCacheUser()) throw new ApiError(409, 'submission_reset');
                    const result = await mediaApi(api).createGeneration({ ...request, idempotencyKey: keys[i], extraInputs: inputsForIndex(request.extraInputs ?? {}, i, count) });
                    if (generation !== epoch || owner !== getCacheUser()) throw new ApiError(409, 'submission_reset');
                    first ??= result.job_id;
                    onStarted?.(i + 1);
                    onJob?.(result.job_id, i);
                }
                pending = null;
                return first;
            } finally { running = false; }
        },
    };
}

export function generationMessage(err: unknown): string {
    if (err instanceof OfflineError) return OFFLINE_PAID_MESSAGE;
    if (!(err instanceof ApiError)) return t('common.error');
    switch (err.code) {
        case 'subscription_required':
            return t('credits.hardPaywall.title');
        case 'source_too_short':
            return t('app.create.error.source_too_short');
        case 'source_resolution_out_of_range':
            return t('app.create.error.source_resolution_out_of_range');
        case 'source_count_exceeded':
            return t('app.create.error.source_count_exceeded');
        case 'sources_too_large':
            return t('app.create.error.sources_too_large');
        case 'source_size_unknown':
            return t('app.create.error.source_size_unknown');
        case 'references_invalid':
            return t('app.create.error.references_invalid');
        case 'references_ambiguous':
            return t('app.create.error.references_ambiguous');
        case 'body_too_large':
            return t('app.create.error.body_too_large');
        case 'idempotency_conflict':
            return t('app.create.error.idempotency_conflict');

        case 'insufficient_credits':
            return t('form.err.insufficient');
        case 'rate_limited':
            return t('form.err.rate');
        case 'credit_confirmation_mismatch':
            return err.body.expected_credits === undefined ? t('form.err.priceChangedUnknown') : t('form.err.priceChanged', { credits: String(err.body.expected_credits) });
        case 'network':
            return t('form.err.network');
        case 'source_not_found':
            return t('form.err.sourceExpired');
        case 'source_type_unsupported':
        case 'source_slot_invalid':
        case 'source_key_invalid':
            return t('form.err.sourceMismatch');
        case 'topic_refused':
            return t('form.err.topicRefused');
        case 'consent_declined':
            return CONSENT_DECLINED_MESSAGE;
        case 'consent_required':
            return t('form.err.tryAgain');
        default:
            return t('form.err.default');
    }
}
