import { createApiClient, ApiError } from '../src/lib/api';
import { createConsentGate, type ConsentGate } from '../src/lib/aiConsent';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';
import { setHardPaywallLocked } from '../src/lib/hardPaywall';
import { createSpeechSubmit } from '../src/lib/speech/speechLedger';
import { type CatalogModel } from '../src/lib/media';
import { buildAuditionRequest, auditionQuote } from '../src/lib/speech/audition';
import { DEFAULT_TTS_SETTINGS, TTS_VOICES } from '../src/lib/speech/shared';
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
const voices = TTS_VOICES.slice(0, 3).map(voice => voice.id);
const request = (ids = voices) => buildAuditionRequest(' Hello ', { ...DEFAULT_TTS_SETTINGS, language: 'English', emotion: 'happy', speed: 1.2, volume: 2, pitch: 3 }, ids, model);
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
const bodies = () => jest.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string));
const accepted = (id: string) => new Response(JSON.stringify({ job_id: id }));
test.each([2, 3])('%s ordered jobs carry only their own six controls, distinct keys and unit ceilings', async count => {
    const submit = createSpeechSubmit(), r = request(voices.slice(0, count));
    await submit.run(client(), r, count, undefined, undefined, auditionQuote(submit, r, 6));
    expect(fetch).toHaveBeenCalledTimes(count);
    expect(new Set(bodies().map(body => body.idempotency_key)).size).toBe(count);
    bodies().forEach((body, index) => {
        expect(body).toEqual({ model_id: model.id, confirmed_credits: 6, max_charge_credits: 6, idempotency_key: expect.any(String),
            inputs: { prompt: 'Hello', tts_voice: voices[index], tts_language: 'English', tts_emotion: 'happy', tts_speed: 1.2, tts_volume: 2, tts_pitch: 3 } });
        expect(body).not.toHaveProperty('inputsByIndex');
    });
});
test.each(['network', 'provider_input_rejected'])('item 2 %s stops before item 3; retry skips item 1 and keeps or rotates the failed key', async refusal => {
    const submit = createSpeechSubmit(), r = request(), api = client(), onJob = jest.fn();
    jest.mocked(fetch).mockResolvedValueOnce(accepted('one'));
    if (refusal === 'network') jest.mocked(fetch).mockRejectedValueOnce(new Error('reply lost'));
    else jest.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: refusal }), { status: 400 }));
    await expect(submit.run(api, r, 3, undefined, onJob, auditionQuote(submit, r, 6))).rejects.toBeInstanceOf(ApiError);
    expect(fetch).toHaveBeenCalledTimes(2);
    const retry = auditionQuote(submit, r, 6);
    expect(retry).toEqual({ ceilings: [null, 6, 6], total: 12, payable: refusal === 'network' ? 6 : 12 });
    jest.mocked(fetch).mockResolvedValueOnce(accepted('two')).mockResolvedValueOnce(accepted('three'));
    await submit.run(api, r, 3, undefined, onJob, retry);
    expect(bodies().map(body => body.inputs.tts_voice)).toEqual([voices[0], voices[1], voices[1], voices[2]]);
    if (refusal === 'network') expect(bodies()[2].idempotency_key).toBe(bodies()[1].idempotency_key);
    else expect(bodies()[2].idempotency_key).not.toBe(bodies()[1].idempotency_key);
    expect(onJob.mock.calls).toEqual([['one', 0], ['one', 0], ['two', 1], ['three', 2]]);
});
test('12 credits spent on two jobs, second reply lost: zero payable allows only the retained-key replay', async () => {
    const submit = createSpeechSubmit(), r = request(voices.slice(0, 2)), api = client();
    expect(auditionQuote(submit, r, 6)).toEqual({ ceilings: [6, 6], total: 12, payable: 12 });
    jest.mocked(fetch).mockResolvedValueOnce(accepted('one')).mockRejectedValueOnce(new Error('accepted but reply lost'));
    await expect(submit.run(api, r, 2, undefined, undefined, auditionQuote(submit, r, 6))).rejects.toBeInstanceOf(ApiError);
    const retry = auditionQuote(submit, r, 6);
    expect(retry).toEqual({ ceilings: [null, 6], total: 6, payable: 0 });
    await submit.run(api, r, 2, undefined, undefined, retry);
    expect(bodies()).toHaveLength(3);
    expect(bodies()[2]).toEqual(bodies()[1]);
});
test.each(['script', 'settings'])('changed %s creates all new keys', async change => {
    const submit = createSpeechSubmit(), r = request(), api = client();
    jest.mocked(fetch).mockResolvedValueOnce(accepted('one')).mockRejectedValueOnce(new Error('lost'));
    await expect(submit.run(api, r, 3)).rejects.toBeInstanceOf(ApiError);
    const oldKeys = bodies().map(body => body.idempotency_key);
    const changed = change === 'script' ? { ...r, prompt: 'Changed' }
        : buildAuditionRequest('Hello', { ...DEFAULT_TTS_SETTINGS, speed: 0.8 }, voices, model);
    await submit.run(api, changed, 3);
    expect(bodies().slice(2)).toHaveLength(3);
    for (const body of bodies().slice(2)) expect(oldKeys).not.toContain(body.idempotency_key);
});
test.each(['consent', 'paywall', 'offline'])('%s blocks all audition POSTs', async guard => {
    if (guard === 'consent') mockGate.setPrompter(async () => false);
    if (guard === 'paywall') setHardPaywallLocked(true);
    if (guard === 'offline') mockOnline.mockRejectedValue(new Error('offline'));
    await expect(createSpeechSubmit().run(client(), request(), 3)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
});
test('every item checks paid access and owner binding again', async () => {
    const submit = createSpeechSubmit();
    await expect(submit.run(client(), request(), 3, count => { if (count > 0) setHardPaywallLocked(true); })).rejects.toMatchObject({ code: 'subscription_required' });
    expect(fetch).toHaveBeenCalledTimes(1);
    setHardPaywallLocked(false); jest.mocked(fetch).mockClear(); mockSubscribers.forEach(fn => fn());
    await expect(createSpeechSubmit().run(client(), request(), 3, count => { if (count > 0) mockOwner = 'account-b'; })).rejects.toMatchObject({ code: 'submission_reset' });
    expect(fetch).toHaveBeenCalledTimes(1);
});
test('a mismatched per-item list is rejected before POST', async () => {
    await expect(createSpeechSubmit().run(client(), request(), 2)).rejects.toMatchObject({ code: 'invalid_inputs' });
    expect(fetch).not.toHaveBeenCalled();
});
test('a retained unknown outcome stays unknown across preflight refusal and clears on proven provider refusal', async () => {
    const submit = createSpeechSubmit(), r = request(), api = client();
    jest.mocked(fetch).mockRejectedValueOnce(new Error('lost reply'));
    await expect(submit.run(api, r, 3)).rejects.toThrow();
    expect(submit.hasUnknownOutcome(r, 3)).toBe(true);
    setHardPaywallLocked(true);
    await expect(submit.run(api, r, 3)).rejects.toMatchObject({ code: 'subscription_required' });
    expect(submit.hasUnknownOutcome(r, 3)).toBe(true);
    setHardPaywallLocked(false);
    jest.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: 'provider_input_rejected' }), { status: 400 }));
    await expect(submit.run(api, r, 3)).rejects.toMatchObject({ code: 'provider_input_rejected' });
    expect(submit.hasUnknownOutcome(r, 3)).toBe(false);
});
