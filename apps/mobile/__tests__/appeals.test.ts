import { ApiError, type ApiClient } from '../src/lib/api';
import { actionLabel, appealErrorMessage, canAppeal, fetchAppeals, statusLabel, submitAppeal, validateStatement } from '../src/lib/appeals';

const ID = '0b5c1f0e-6a52-4f54-9d1c-3a0e5a2b9c11';
const apiWith = (result: unknown) => {
    const request = jest.fn(async () => {
        if (result instanceof Error) throw result;
        return result;
    });
    return { api: { request } as unknown as ApiClient, request };
};

describe('fetchAppeals', () => {
    test('maps decisions, drops malformed rows, never exposes other fields', async () => {
        const { api } = apiWith({
            sanctions: [
                { action_id: ID, action: 'takedown', created_at: '2026-10-01T10:00:00Z', appeal_status: 'open', model_id: 'x', reason: 'secret' },
                { action_id: 'bad', action: 'warning', created_at: '2026-10-01T10:00:00Z' },
                { action_id: ID, action: 'mystery', created_at: '2026-10-02T10:00:00Z', appeal_status: 'odd' },
            ],
            hold_until: '2026-10-20T00:00:00Z',
            frozen: true,
        });
        const state = await fetchAppeals(api);
        expect(state.sanctions).toEqual([
            { actionId: ID, action: 'takedown', createdAt: '2026-10-01T10:00:00Z', appealStatus: 'open' },
            { actionId: ID, action: 'other', createdAt: '2026-10-02T10:00:00Z', appealStatus: null },
        ]);
        expect(state.holdUntil).toBe('2026-10-20T00:00:00Z');
        expect(state.frozen).toBe(true);
    });

    test('an empty or odd answer is an empty record', async () => {
        expect(await fetchAppeals(apiWith({}).api)).toEqual({ sanctions: [], holdUntil: null, frozen: false });
    });
});

describe('wording and rules', () => {
    test('labels', () => {
        expect(actionLabel('freeze')).toBe('Account frozen');
        expect(actionLabel('unknown')).toBe('Decision');
        expect(statusLabel('rejected')).toBe('Appeal not successful');
    });
    test('statement length mirrors the server', () => {
        expect(validateStatement('too short')).toMatch(/at least 10/);
        expect(validateStatement('   short   ')).not.toBeNull();
        expect(validateStatement('x'.repeat(10))).toBeNull();
        expect(validateStatement('x'.repeat(2001))).toMatch(/too long/);
    });
    test('only a decision with no appeal can be appealed', () => {
        const base = { actionId: ID, action: 'warning' as const, createdAt: '' };
        expect(canAppeal({ ...base, appealStatus: null })).toBe(true);
        expect(canAppeal({ ...base, appealStatus: 'open' })).toBe(false);
    });
    test('error wording', () => {
        expect(appealErrorMessage(new ApiError(0, 'network'))).toMatch(/No connection/);
        expect(appealErrorMessage(new ApiError(429, 'rate_limited'))).toMatch(/Too many/);
        expect(appealErrorMessage(new ApiError(404, 'action_not_found'))).toMatch(/cannot be appealed/);
        expect(appealErrorMessage(new ApiError(502, 'appeals_unavailable'))).toMatch(/could not be sent/);
    });
});

describe('submitAppeal', () => {
    test('sends the trimmed statement and the decision id as JSON', async () => {
        const { api, request } = apiWith({ appeal_id: 'a', status: 'open', replayed: false });
        expect(await submitAppeal(api, ID, '  This was my own photo.  ')).toEqual({ status: 'open', replayed: false });
        const [path, init] = request.mock.calls[0] as unknown as [string, RequestInit];
        expect(path).toBe('/api/v1/appeals');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ action_id: ID, statement: 'This was my own photo.' });
    });
    test('a repeat is a success, not an error', async () => {
        expect((await submitAppeal(apiWith({ status: 'upheld', replayed: true }).api, ID, 'Please look again.')).replayed).toBe(true);
    });
    test('refuses a bad statement or id before any request', async () => {
        const { api, request } = apiWith({});
        await expect(submitAppeal(api, ID, 'short')).rejects.toThrow();
        await expect(submitAppeal(api, 'nope', 'Long enough text.')).rejects.toThrow();
        expect(request).not.toHaveBeenCalled();
    });
});
