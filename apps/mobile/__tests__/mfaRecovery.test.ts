import { ApiError, type ApiClient } from '../src/lib/api';
import { codesErrorKey, consumeRecoveryCode, fetchRecoveryStatus, formatRecoveryInput, generateRecoveryCodes, normalizeRecoveryCode, recoverErrorKey, validRecoveryCode } from '../src/lib/mfaRecovery';

const apiReturning = (value: unknown): ApiClient & { request: jest.Mock } => ({ request: jest.fn().mockResolvedValue(value), stream: jest.fn(), getBalance: jest.fn() }) as never;

describe('recovery code entry', () => {
    test('matches the server: case, dashes and spaces ignored, I/L as 1, O as 0, U refused', () => {
        expect(normalizeRecoveryCode('abcde-fghjk')).toBe('ABCDEFGHJK');
        expect(normalizeRecoveryCode('ab cde fghjk')).toBe('ABCDEFGHJK');
        expect(normalizeRecoveryCode('1lo00-11o00')).toBe('1100011000');
        expect(normalizeRecoveryCode('ABCDE-FGHJU')).toBeNull();
        expect(normalizeRecoveryCode('ABCDE')).toBeNull();
        expect(validRecoveryCode('ABCDE-FGHJK')).toBe(true);
    });
    test('input is shown with the dash after five characters and capped at ten', () => {
        expect(formatRecoveryInput('abc')).toBe('ABC');
        expect(formatRecoveryInput('abcdefg')).toBe('ABCDE-FG');
        expect(formatRecoveryInput('abcdefghjkmnp')).toBe('ABCDE-FGHJK');
    });
});

describe('recovery calls', () => {
    test('consume sends only the normalised code and tells recovered from stale', async () => {
        const ok = apiReturning({ recovered: true });
        await expect(consumeRecoveryCode(ok, 'abcde-fghjk')).resolves.toBe('recovered');
        expect(ok.request).toHaveBeenCalledWith('/api/v1/mfa/recovery', expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: 'ABCDEFGHJK' }) }));
        await expect(consumeRecoveryCode(apiReturning({ recovered: false, stale: true }), 'ABCDE-FGHJK')).resolves.toBe('stale');
        await expect(consumeRecoveryCode(apiReturning({}), 'ABCDE-FGHJK')).rejects.toMatchObject({ code: 'recovery_incomplete' });
    });
    test('a malformed code never reaches the network', async () => {
        const api = apiReturning({});
        await expect(consumeRecoveryCode(api, 'nope')).rejects.toMatchObject({ code: 'invalid_recovery_code' });
        expect(api.request).not.toHaveBeenCalled();
    });
    test('status and generate read the server shape', async () => {
        await expect(fetchRecoveryStatus(apiReturning({ usable: 7, needs_regeneration: false }))).resolves.toEqual({ usable: 7, needsRegeneration: false });
        await expect(fetchRecoveryStatus(apiReturning({}))).resolves.toEqual({ usable: 0, needsRegeneration: false });
        await expect(generateRecoveryCodes(apiReturning({ codes: ['AAAAA-BBBBB', 3] }))).resolves.toEqual(['AAAAA-BBBBB']);
        await expect(generateRecoveryCodes(apiReturning({ codes: [] }))).rejects.toBeInstanceOf(ApiError);
    });
});

describe('error words', () => {
    test('known server codes pick their own message, anything else the general one', () => {
        expect(recoverErrorKey(new ApiError(429, 'recovery_rate_limited'))).toBe('authGate.mfa.recovery.error.recovery_rate_limited');
        expect(recoverErrorKey(new ApiError(400, 'invalid_recovery_code'))).toBe('authGate.mfa.recovery.error.invalid_recovery_code');
        expect(recoverErrorKey(new ApiError(503, 'recovery_unavailable'))).toBe('authGate.mfa.recovery.failed');
        expect(recoverErrorKey(new Error('x'))).toBe('authGate.mfa.recovery.failed');
        expect(codesErrorKey(new ApiError(403, 'reauth_required'))).toBe('app.account.mfa.recovery.error.reauth_required');
        expect(codesErrorKey(new ApiError(500, 'boom'))).toBe('app.account.mfa.recovery.failed');
    });
});
