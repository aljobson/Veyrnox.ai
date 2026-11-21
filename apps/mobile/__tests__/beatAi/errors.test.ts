import { ApiError } from '../../src/lib/api';
import { errorKey, errorParams, retireOnError, surfaceUnavailable } from '../../src/lib/beatAi/errors';
const mappings = [
    ['plan_unavailable', 'a29'], ['insufficient_balance', 'a30'], ['quote_expired', 'a36'], ['quote_stale', 'a37'],
    ['quote_already_used', 'a38'], ['idempotency_conflict', 'a39'], ['prompt_blocked', 'a31'], ['prompt_not_allowed', 'a31'],
    ['prompt_invalid', 'a6'], ['range_invalid', 'a9'], ['source_duration_invalid', 'a32'], ['source_unavailable', 'a33'],
    ['model_unavailable', 'a35'], ['rate_limited', 'a44'], ['mfa_required', 'a28'], ['not_found', 'a26'],
];
test.each(mappings)('%s maps both server envelopes to %s', (code, key) => {
    for (const error of [code, { code }]) expect(errorKey(new ApiError(400, 'fallback', { error }))).toBe(`beatAi.${key}`);
});
test('rate limit keeps the server wait in the translated message; MFA beats generic authentication copy', () => {
    expect(errorParams(new ApiError(429, 'rate_limited', { retryAfterSeconds: 23 }))).toEqual({ n: 23 });
    expect(errorParams(new ApiError(429, 'rate_limited'))).toEqual({ n: 60 });
    expect(errorKey(new ApiError(401, 'mfa_required'))).toBe('beatAi.a28');
});
test.each(['music_extend_unavailable', 'music_target_stems_unavailable', 'music_replace_unavailable'])('%s is local to the action and never retires a 404 receipt', code => {
    const error = new ApiError(404, code);
    expect(retireOnError(error)).toBe(false); expect(surfaceUnavailable(error)).toBe(false); expect(errorKey(error)).toBe('beatAi.a35');
});
