import { getCacheUser } from './appCache';
import * as Crypto from 'expo-crypto';
import { CONSENT_DECLINED_MESSAGE } from './aiConsent';
import { ApiError, type ApiClient } from './api';
import { OFFLINE_PAID_MESSAGE, OfflineError } from './network';
import { inputsForIndex } from './createOptions';
import { mediaApi, type GenerationRequest } from './media';
import { t } from './i18n';

export type SubmitRequest = Omit<GenerationRequest, 'idempotencyKey'>;

// Price/allowance metadata never changes request identity or retry keys.
export function generationSignature(request: SubmitRequest, count: number) {
    const { modelId, prompt, textKey, durationSeconds, extraInputs, references, sources, assets, sourceRights, preset } = request;
    return JSON.stringify({ modelId, prompt, textKey, durationSeconds, extraInputs, references, sources, assets, sourceRights, preset, count });
}
export const unknownGenerationOutcome = (err: unknown) => !(err instanceof ApiError)
    || ['network', 'internal', 'gateway_error', 'debit_failed', 'account_changed', 'dispatch_acceptance_unknown', 'admission_unknown', 'outcome_unknown', 'bad_response'].includes(err.code)
    // An untyped server error is not proof that nothing was charged.
    || (err.code === 'unknown' && err.status >= 500);
export type ChargeSnapshot = { ceilings: (number | null)[]; total: number; payable: number };
export function createGenerationSubmit() {
    let pending: { signature: string; keys: string[]; accepted: (string | null)[]; unknown: Set<number> } | null = null;
    let running = false;
    let epoch = 0;
    return {
        reset() { pending = null; epoch++; },
        snapshot(request: SubmitRequest, count: number, unit: number, freeNow: number): ChargeSnapshot {
            const same = pending?.signature === generationSignature(request, count) ? pending : null;
            let free = Math.max(0, Math.floor(freeNow));
            const ceilings = Array.from({ length: count }, (_, i) => {
                if (same?.accepted[i]) return null;
                // Reconcile with the existing key and paid ceiling, without reserving another free slot.
                if (same?.unknown.has(i)) return unit;
                if (free > 0) { free--; return 0; }
                return unit;
            });
            // total is the most this click may charge (shown to the person). payable leaves out unknown items:
            // their retained key replays, which debits nothing if the lost reply hid an accepted job, so they
            // never block the affordability check. Their ceiling still caps a fresh admission.
            return { ceilings, total: ceilings.reduce<number>((sum, value) => sum + (value ?? 0), 0),
                payable: ceilings.reduce<number>((sum, value, i) => sum + (same?.unknown.has(i) ? 0 : (value ?? 0)), 0) };
        },
        async run(api: ApiClient, request: SubmitRequest, count = 1, onStarted?: (count: number) => void, onJob?: (jobId: string, index: number) => void, quote?: ChargeSnapshot) {
            if (running) throw new ApiError(409, 'submission_in_progress');
            const signature = generationSignature(request, count);
            if (pending?.signature !== signature) pending = { signature, keys: Array.from({ length: count }, () => Crypto.randomUUID()), accepted: Array(count).fill(null), unknown: new Set() };
            const run = pending;
            running = true;
            const generation = epoch;
            const owner = getCacheUser();
            try {
                for (let i = 0; i < count; i++) {
                    if (generation !== epoch || owner !== getCacheUser()) throw new ApiError(409, 'submission_reset');
                    if (run.accepted[i]) continue;
                    let result;
                    try {
                        result = await mediaApi(api).createGeneration({ ...request,
                            ...(quote ? { maxCharge: quote.ceilings[i] ?? 0 } : {}),
                            idempotencyKey: run.keys[i], extraInputs: inputsForIndex(request.extraInputs ?? {}, i, count) });
                    } catch (err) {
                        if (unknownGenerationOutcome(err)) run.unknown.add(i);
                        else run.unknown.delete(i);
                        throw err;
                    }
                    if (generation !== epoch || owner !== getCacheUser()) throw new ApiError(409, 'submission_reset');
                    run.accepted[i] = result.job_id;
                    run.unknown.delete(i);
                    onStarted?.(run.accepted.filter(Boolean).length);
                    onJob?.(result.job_id, i);
                }
                pending = null;
                return run.accepted[0];
            } finally { running = false; }
        },
    };
}

export function generationMessage(err: unknown): string {
    if (err instanceof OfflineError) return OFFLINE_PAID_MESSAGE;
    if (!(err instanceof ApiError)) return t('common.error');
    switch (err.code) {
        case 'price_changed':
        case 'admission_unknown':
        case 'admission_unavailable':
            return t(`app.create.error.${err.code}`);
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
