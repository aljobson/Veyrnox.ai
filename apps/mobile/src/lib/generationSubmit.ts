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
    return {
        reset() { pending = null; },
        async run(api: ApiClient, request: SubmitRequest, count = 1, onStarted?: (count: number) => void) {
            if (running) throw new ApiError(409, 'submission_in_progress');
            // The signature now covers the whole request, including price and explicit rights, plus batch count.
            const signature = JSON.stringify({ ...request, count });
            const keys = pending?.signature === signature ? pending.keys : Array.from({ length: count }, () => Crypto.randomUUID());
            pending = { signature, keys };
            running = true;
            let first: string | null = null;
            try {
                for (let i = 0; i < count; i++) {
                    const result = await mediaApi(api).createGeneration({ ...request, idempotencyKey: keys[i], extraInputs: inputsForIndex(request.extraInputs ?? {}, i, count) });
                    first ??= result.job_id;
                    onStarted?.(i + 1);
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
