// Pure transport and guard tests; no device interactions or UI locators.
import { ApiError, createApiClient, type ApiClient } from '../src/lib/api';
import { aiEditKeyFor, fetchAiEditQuote, runAiEdit, recoverAiEdit, AI_EDIT_PATH } from '../src/lib/editorAiEdit';
import { createConsentGate, sendsContent } from '../src/lib/aiConsent';
import { guardPaidAction, isPaidAction, setHardPaywallLocked } from '../src/lib/hardPaywall';
import { resetNetworkState, markOffline } from '../src/lib/networkState';
import { emptyTimeline } from '../src/lib/nativeEditorModel';
const accountId = '11111111-1111-4111-8111-111111111111';
const token = `x.${btoa(JSON.stringify({ sub: accountId }))}.x`;
const completed = { status: 'completed', credits: 3, plan: { commands: [{ op: 'addText', text: 'Title', start: 0, len: 30 }] }, skipped: [], summary: '1 step' };
const args = () => ({ instruction: 'Add a title', timeline: emptyTimeline(), key: 'key-12345678', expectedCredits: 3, accountId });
const api = (request: jest.Mock) => ({ request }) as unknown as ApiClient;
const original = globalThis.fetch;
beforeEach(() => { resetNetworkState(); setHardPaywallLocked(false); });
afterEach(() => { globalThis.fetch = original; jest.useRealTimers(); setHardPaywallLocked(false); });
test('quote supplies price; unavailable hides the feature', async () => {
    const request = jest.fn().mockResolvedValueOnce({ credits: 7 }).mockResolvedValueOnce({ credits: 11 }).mockRejectedValueOnce(new ApiError(501, 'editor_ai_edit_unavailable'));
    expect((await fetchAiEditQuote(api(request)))?.credits).toBe(7);
    expect((await fetchAiEditQuote(api(request)))?.credits).toBe(11);
    expect(await fetchAiEditQuote(api(request))).toBeNull();
});
test('POST retains auth ownership, exact body, quoted price and a 60-second deadline', async () => {
    const request = jest.fn().mockResolvedValue(completed), value = args(); await runAiEdit(api(request), value);
    const [path, init, options] = request.mock.calls[0];
    expect(path).toBe(AI_EDIT_PATH); expect(options).toEqual({ owner: accountId, timeoutMs: 60_000 });
    expect(JSON.parse(init.body)).toEqual({ instruction: value.instruction, timeline: value.timeline, idempotencyKey: value.key, expectedCredits: 3 });
});
test('offline never starts a paid POST', async () => {
    markOffline(); const request = jest.fn(); await expect(runAiEdit(api(request), args())).rejects.toMatchObject({ message: 'offline' }); expect(request).not.toHaveBeenCalled();
});
test('lost response uses read-only recovery, never another POST', async () => {
    const request = jest.fn().mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValueOnce(completed);
    expect(await runAiEdit(api(request), args())).toEqual(completed);
    expect(request.mock.calls[1]).toEqual([`${AI_EDIT_PATH}/by-key/key-12345678`, {}, { owner: accountId }]);
    expect(request).toHaveBeenCalledTimes(2);
});
test('an explicit retry after a missing recovery record preserves the request identity', async () => {
    const request = jest.fn().mockRejectedValueOnce(new ApiError(0, 'network'))
        .mockRejectedValueOnce(new ApiError(404, 'request_not_found')).mockResolvedValueOnce(completed);
    const captured = args();
    await expect(runAiEdit(api(request), captured)).rejects.toMatchObject({ code: 'outcome_pending' });
    expect(await runAiEdit(api(request), captured)).toEqual(completed);
    expect(request.mock.calls[2]).toEqual(request.mock.calls[0]);
});
test('only confirmed refunds carry the not-charged state', async () => {
    const refunded = jest.fn().mockRejectedValue(new ApiError(422, 'plan_unusable', { refunded: true }));
    await expect(runAiEdit(api(refunded), args())).rejects.toMatchObject({ body: { refunded: true } }); expect(refunded).toHaveBeenCalledTimes(1);
    const pending = jest.fn().mockRejectedValue(new ApiError(503, 'outcome_pending'));
    await expect(runAiEdit(api(pending), args())).rejects.toMatchObject({ code: 'outcome_pending', body: {} });
});
test('key reuse compares full timeline content, not clip ids/times alone', () => {
    const tl = emptyTimeline(), make = jest.fn().mockReturnValueOnce('one').mockReturnValueOnce('two');
    const first = aiEditKeyFor(null, ' Add  title ', tl, make);
    expect(aiEditKeyFor(first, 'Add title', { ...tl }, make)).toBe(first);
    expect(aiEditKeyFor(first, 'Add title', { ...tl, background: '#ffffff' }, make).key).toBe('two');
    expect(make).toHaveBeenCalledTimes(2);
});
test('declining consent prevents the request; quote and recovery are exempt', async () => {
    const gate = createConsentGate({ get: async () => null, set: async () => {}, remove: async () => {} }); gate.setUser(accountId); gate.setPrompter(async () => false);
    const fetcher = jest.fn(); globalThis.fetch = fetcher;
    const client = createApiClient({ baseUrl: 'https://test.invalid', getAccessToken: async () => token, onSessionLost: jest.fn(), beforeSend: gate.ensure });
    await expect(runAiEdit(client, args())).rejects.toMatchObject({ code: 'consent_declined' }); expect(fetcher).not.toHaveBeenCalled();
    expect(sendsContent(AI_EDIT_PATH, 'POST')).toBe(true); expect(sendsContent(`${AI_EDIT_PATH}/quote`, 'GET')).toBe(false);
});
test('locked account cannot POST but can read its paid result', async () => {
    setHardPaywallLocked(true);
    const fetcher = jest.fn().mockResolvedValue({ status: 200, ok: true, headers: new Headers(), json: async () => completed }); globalThis.fetch = fetcher;
    const client = createApiClient({ baseUrl: 'https://test.invalid', getAccessToken: async () => token, onSessionLost: jest.fn(), beforeSend: async (path, method) => guardPaidAction(path, method) });
    await expect(runAiEdit(client, args())).rejects.toMatchObject({ code: 'subscription_required' }); expect(fetcher).not.toHaveBeenCalled();
    expect(await recoverAiEdit(client, args().key, accountId)).toEqual(completed); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(isPaidAction(`${AI_EDIT_PATH}/by-key/key-12345678`, 'GET')).toBe(false);
});
test('60-second JSON deadline allows a 31-second success and bounds a stalled body', async () => {
    jest.useFakeTimers();
    const client = createApiClient({ baseUrl: 'https://test.invalid', getAccessToken: async () => token, onSessionLost: jest.fn() });
    globalThis.fetch = jest.fn().mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve({ status: 200, ok: true, json: async () => completed }), 31_000)));
    const success = client.request(AI_EDIT_PATH, {}, { timeoutMs: 60_000 });
    await jest.advanceTimersByTimeAsync(31_000); expect(await success).toEqual(completed);
    globalThis.fetch = jest.fn().mockResolvedValue({ status: 200, ok: true, json: () => new Promise(() => {}) });
    const stalled = client.request(AI_EDIT_PATH, {}, { timeoutMs: 60_000 });
    const check = expect(stalled).rejects.toMatchObject({ code: 'network', body: { timedOut: true } });
    await jest.advanceTimersByTimeAsync(60_000); await check; expect(jest.getTimerCount()).toBe(0);
});
