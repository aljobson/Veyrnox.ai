// Catalogs retain exact web ERROR_COPY parity. Revision 1 deliberately changes
// displayed refund tails until job.refunded === true: a refused submit alone
// cannot prove a refund landed. All 11 translations support exact fragment
// replacement; if that stops being safe, use existing generic + pending copy.
import { ApiError } from '../src/lib/api';
import { generationMessage } from '../src/lib/generationSubmit';
import { CREATE_ERROR_CODES, failedJobMessage } from '../src/lib/failedJob';
import { CONSENT_DECLINED_MESSAGE } from '../src/lib/aiConsent';
import { OfflineError, OFFLINE_PAID_MESSAGE } from '../src/lib/network';
import { chooseLocale, LOCALE_CODES, WEB_CATALOGS, t } from '../src/lib/i18n';
import en from '../src/lib/i18n/messages/en';
import webKeys from '../src/lib/i18n/webKeys.json';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../src/lib/media', () => ({ mediaApi: jest.fn() }));

declare const require: (id: string) => any;
declare const __dirname: string;
const { readFileSync } = require('fs');
const { join } = require('path');
function webCatalog(locale: string): Record<string, string> {
    return Object.assign({}, ...['data-errors', 'create'].map(area => {
        const source = readFileSync(join(__dirname, '../../../lib/i18n/messages/app', locale, `${area}.mjs`), 'utf8');
        return new Function(source.replace(/^export default\s+/m, 'return '))();
    }));
}
const refundCodes = ['provider_moderation', 'moderation', 'provider_input_rejected',
    'provider_submit_failed', 'provider_timeout', 'provider_error', 'internal', 'topic_refused'];
const requiredCodes = [
    'model_gated', 'model_region_unavailable', 'account_frozen', 'account_on_hold',
    'user_not_provisioned', 'debit_rejected', ...refundCodes,
    'duration_not_supported', 'duration_invalid', 'insufficient_balance', 'source_required',
    'upload_failed', 'upload_type_not_allowed', 'upload_type_mismatch', 'upload_too_large',
    'upload_dimensions_too_large', 'upload_unreadable', 'source_too_large', 'source_too_long',
    'source_length_unknown', 'lipsync_video_length_unknown', 'lipsync_audio_exceeds_video',
    'dialogue_invalid', 'dispatch_acceptance_unknown', 'outcome_unknown',
    'inputs_invalid:topic', 'inputs_invalid:prompt', 'inputs_invalid:voice_description', 'rate_limited',
];
const sharedExisting = ['price_changed', 'admission_unknown', 'admission_unavailable', 'source_too_short',
    'source_resolution_out_of_range', 'source_count_exceeded', 'sources_too_large', 'source_size_unknown',
    'references_invalid', 'references_ambiguous', 'body_too_large', 'idempotency_conflict'];
beforeEach(() => chooseLocale('en'));
afterEach(() => chooseLocale('en'));

test('the lookup covers every frozen work-order code and existing shared code', () => {
    expect([...CREATE_ERROR_CODES].sort()).toEqual([...requiredCodes, ...sharedExisting].sort());
    expect(CREATE_ERROR_CODES.has('user_cancelled')).toBe(false);
});

test.each(LOCALE_CODES)('%s has every shared key directly, verbatim from the web, without fallback', locale => {
    const web = webCatalog(locale);
    const own = (locale === 'en' ? en : WEB_CATALOGS[locale]) as Record<string, string>;
    const keys = [...CREATE_ERROR_CODES].map(code => `app.create.error.${code}`)
        .concat(['app.data.refunded', 'app.data.refundPending', 'app.create.retryIn']);
    for (const key of keys) {
        expect(webKeys).toContain(key);
        expect(Object.prototype.hasOwnProperty.call(own, key)).toBe(true);
        expect(typeof web[key]).toBe('string');
        expect(own[key]).toBe(web[key]);
    }
});

test.each(LOCALE_CODES)('%s preserves specific reasons and changes only the unconfirmed refund fragment', locale => {
    chooseLocale(locale);
    const web = webCatalog(locale);
    for (const code of CREATE_ERROR_CODES) {
        const copy = web[`app.create.error.${code}`];
        const refundBearing = refundCodes.includes(code);
        if (refundBearing) expect(copy.split(web['app.data.refunded'])).toHaveLength(2);
        const pending = refundBearing ? copy.replace(web['app.data.refunded'], web['app.data.refundPending']) : copy;
        expect(generationMessage(new ApiError(400, code))).toBe(pending);
        expect(failedJobMessage(code, true)).toBe(copy);
        expect(failedJobMessage(code, false)).toBe(pending);
        expect(failedJobMessage(code, undefined)).toBe(pending);
    }
});

test.each(LOCALE_CODES)('%s rate limit uses translated retry-after wording only when supplied', locale => {
    chooseLocale(locale);
    expect(generationMessage(new ApiError(429, 'rate_limited'))).toBe(t('app.create.error.rate_limited'));
    expect(generationMessage(new ApiError(429, 'rate_limited', { retryAfterSeconds: 12 })))
        .toBe(t('app.create.error.rate_limited') + t('app.create.retryIn', { seconds: 12 }));
});

test.each([
    ['subscription_required', 'credits.hardPaywall.title'], ['insufficient_credits', 'form.err.insufficient'],
    ['network', 'form.err.network'], ['source_not_found', 'form.err.sourceExpired'],
    ['source_type_unsupported', 'form.err.sourceMismatch'], ['source_slot_invalid', 'form.err.sourceMismatch'],
    ['source_key_invalid', 'form.err.sourceMismatch'], ['consent_required', 'form.err.tryAgain'],
    ['credit_confirmation_mismatch', 'form.err.priceChangedUnknown'], ['unrecognized_code', 'form.err.default'],
])('existing %s behavior is unchanged', (code, key) => {
    expect(generationMessage(new ApiError(400, code))).toBe(t(key));
});

test('confirmation metadata, declined consent, offline and non-API failures are unchanged', () => {
    expect(generationMessage(new ApiError(409, 'credit_confirmation_mismatch', { expected_credits: 9 })))
        .toBe(t('form.err.priceChanged', { credits: '9' }));
    expect(generationMessage(new ApiError(400, 'consent_declined'))).toBe(CONSENT_DECLINED_MESSAGE);
    expect(generationMessage(new OfflineError())).toBe(OFFLINE_PAID_MESSAGE);
    for (const value of [new Error('oops'), null, undefined, { code: 'provider_error' }]) {
        expect(generationMessage(value)).toBe(t('common.error'));
    }
});

test.each([true, false, undefined])('unknown and cancelled jobs retain the caller fallback (refunded=%s)', refunded => {
    for (const code of ['unknown', 'user_cancelled', undefined, null]) {
        expect(failedJobMessage(code, refunded)).toBe(t('library.status.failed'));
        expect(failedJobMessage(code, refunded, 'existing screen copy')).toBe('existing screen copy');
    }
});
