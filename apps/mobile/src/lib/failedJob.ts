import { t } from './i18n';

// Shared web copy reachable from phone Create, including its existing shared errors.
export const CREATE_ERROR_CODES: ReadonlySet<string> = new Set([
    'price_changed', 'admission_unknown', 'admission_unavailable',
    'source_too_short', 'source_resolution_out_of_range', 'source_count_exceeded',
    'sources_too_large', 'source_size_unknown', 'references_invalid',
    'references_ambiguous', 'body_too_large', 'idempotency_conflict',
    'model_gated', 'model_region_unavailable', 'account_frozen', 'account_on_hold',
    'user_not_provisioned', 'debit_rejected', 'provider_moderation', 'moderation',
    'provider_input_rejected', 'provider_submit_failed', 'provider_timeout',
    'provider_error', 'internal', 'duration_not_supported', 'duration_invalid',
    'insufficient_balance', 'source_required', 'upload_failed',
    'upload_type_not_allowed', 'upload_type_mismatch', 'upload_too_large',
    'upload_dimensions_too_large', 'upload_unreadable', 'source_too_large',
    'source_too_long', 'source_length_unknown', 'lipsync_video_length_unknown',
    'lipsync_audio_exceeds_video', 'dialogue_invalid', 'dispatch_acceptance_unknown',
    'outcome_unknown', 'inputs_invalid:topic', 'inputs_invalid:prompt',
    'inputs_invalid:voice_description', 'rate_limited', 'topic_refused',
]);

const REFUND_COPY_CODES = new Set([
    'provider_moderation', 'moderation', 'provider_input_rejected',
    'provider_submit_failed', 'provider_timeout', 'provider_error', 'internal', 'topic_refused',
]);

// A submit refusal does not prove that the refund landed. Only a job can do that.
export function createErrorMessage(errorCode: string | null | undefined, refunded?: boolean): string | undefined {
    if (!errorCode || !CREATE_ERROR_CODES.has(errorCode)) return undefined;
    const key = `app.create.error.${errorCode}`;
    const message = t(key);
    if (message === key) return undefined;
    if (refunded === true || !REFUND_COPY_CODES.has(errorCode)) return message;
    // The exact standalone fragment occurs once in every supported translation;
    // tests check all eleven catalogs. Never guess at localized sentence boundaries.
    const parts = message.split(t('app.data.refunded'));
    return parts.length === 2 ? parts.join(t('app.data.refundPending'))
        : `${t('common.error')} ${t('app.data.refundPending')}`;
}

export function failedJobMessage(errorCode: string | null | undefined, refunded?: boolean, fallback = t('library.status.failed')): string {
    // Cancellation retains each screen's existing cancellation/refund presentation.
    return createErrorMessage(errorCode, refunded) ?? fallback;
}
