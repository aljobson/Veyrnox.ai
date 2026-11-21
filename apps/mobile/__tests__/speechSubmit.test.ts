import { createApiClient, ApiError } from '../src/lib/api';
import { createConsentGate, type ConsentGate } from '../src/lib/aiConsent';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { setHardPaywallLocked } from '../src/lib/hardPaywall';
import { createSpeechSubmit } from '../src/lib/speech/speechLedger';
import { mediaApi, type CatalogModel } from '../src/lib/media';
import { buildSpeechRequest } from '../src/lib/speech/studio';
import { DEFAULT_TTS_SETTINGS } from '../src/lib/speech/shared';
let mockOwner = 'account-a';
const mockSubscribers = new Set<() => void>();
let mockGate: ConsentGate;
const mockOnline = jest.fn();
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { mockSubscribers.add(fn); return () => mockSubscribers.delete(fn); } }));
jest.mock('../src/lib/network', () => ({ ensureOnline: () => mockOnline(), markOnline: jest.fn(), markOffline: jest.fn() }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: (p: string, m: string) => mockGate.ensure(p, m), hasAgreed: () => mockGate.hasAgreed() } }));
jest.mock('../src/lib/submittedRequests', () => ({ rememberSubmitted: async () => {}, submittedRequests: { list: async () => [] } }));
jest.mock('../src/lib/celebrate', () => ({ noteLocalSubmission: jest.fn() }));
jest.mock('../src/lib/generationProgress', () => ({ noteJobStarted: jest.fn() }));
jest.mock('../src/lib/analytics/generations', () => ({ noteGenerationSubmitted: jest.fn() }));
jest.mock('expo-crypto', () => { let n = 0; return { randomUUID: jest.fn(() => ['speech', 'attempt', ++n].join('-')) }; });
const model: CatalogModel = { id: 'minimax-speech-2.6-hd', name: 'Speech', modality: 'text-to-speech', credits: 6, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
const request = () => buildSpeechRequest(' Hello ', DEFAULT_TTS_SETTINGS, model);
const client = () => createApiClient({ baseUrl: 'https://speech.invalid', getAccessToken: async () => ['header', btoa(JSON.stringify({ sub: mockOwner })), 'signature'].join('.'), onSessionLost: jest.fn(), beforeSend: guardedBeforeSend });
const savedFetch = globalThis.fetch;
beforeEach(() => {
    mockOwner = 'account-a'; mockSubscribers.forEach(fn => fn()); mockOnline.mockReset().mockResolvedValue(undefined); setHardPaywallLocked(false);
    const map = new Map<string, string>();
    mockGate = createConsentGate({ get: async k => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); }, remove: async k => { map.delete(k); } });
    mockGate.setUser(mockOwner); mockGate.setPrompter(async () => true);
    globalThis.fetch = jest.fn().mockImplementation(async () => new Response(JSON.stringify({ job_id: 'job' })));
});
afterEach(() => { globalThis.fetch = savedFetch; setHardPaywallLocked(false); jest.restoreAllMocks(); });
test('real submit/media/API path sends exactly the six controls and displayed price ceiling', async () => {
    const submit = createSpeechSubmit(), r = request();
    await submit.run(client(), r, 1, undefined, undefined, submit.snapshot(r, 1, 6, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = jest.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://speech.invalid/api/v1/generations');
    expect(JSON.parse(init!.body as string)).toEqual({ model_id: model.id, confirmed_credits: 6, max_charge_credits: 6,
        idempotency_key: expect.any(String), inputs: { prompt: 'Hello', tts_voice: 'Wise_Woman', tts_language: 'auto', tts_emotion: 'neutral', tts_speed: 1, tts_volume: 1, tts_pitch: 0 } });
});
test('real consent gate declines before any generation leaves', async () => {
    mockGate.setPrompter(async () => false);
    await expect(createSpeechSubmit().run(client(), request())).rejects.toMatchObject({ code: 'consent_declined' });
    expect(fetch).not.toHaveBeenCalled();
});
test('real paid-action guard locks the API path before any request leaves', async () => {
    setHardPaywallLocked(true);
    await expect(createSpeechSubmit().run(client(), request())).rejects.toMatchObject({ code: 'subscription_required' });
    expect(fetch).not.toHaveBeenCalled();
});
test.each(['online', 'consent', 'agreement'] as const)('account switch during %s preflight cannot POST A’s script as B', async stage => {
    let release!: () => void, entered!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const suspended = new Promise<void>(resolve => { entered = resolve; });
    const pause = async () => { entered(); await wait; };
    if (stage === 'online') mockOnline.mockImplementationOnce(pause);
    else if (stage === 'consent') jest.spyOn(mockGate, 'ensure').mockImplementationOnce(pause);
    else jest.spyOn(mockGate, 'hasAgreed').mockImplementationOnce(async () => { await pause(); return true; });
    const run = mediaApi(client()).createGeneration({ ...request(), idempotencyKey: ['owner', 'switch', stage].join('-') });
    await suspended;
    mockOwner = 'account-b'; mockGate.setUser(mockOwner); release();
    await expect(run).rejects.toMatchObject({ code: 'account_changed' });
    expect(fetch).not.toHaveBeenCalled();
});
test('unchanged uncertain retry uses one key; a changed request uses another', async () => {
    const submit = createSpeechSubmit(), api = client(), r = request();
    jest.mocked(fetch).mockRejectedValueOnce(new Error('lost response'));
    await expect(submit.run(api, r)).rejects.toBeInstanceOf(ApiError);
    await submit.run(api, r);
    await submit.run(api, { ...r, prompt: 'Changed' });
    const bodies = jest.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies[0].idempotency_key).toBe(bodies[1].idempotency_key);
    expect(bodies[2].idempotency_key).not.toBe(bodies[1].idempotency_key);
});
