import { AppState, Linking } from 'react-native';
jest.setTimeout(30_000);
const mockFiles = new Map<string, string>();
const mockSet = jest.fn(async (key: string, value: string) => { mockFiles.set(key, value); });
jest.mock('../src/lib/appCache', () => ({ appStorage: {
    get: jest.fn(async (key: string) => mockFiles.get(key) ?? null), set: (...args: [string, string]) => mockSet(...args),
    keys: async () => [...mockFiles.keys()], remove: async (key: string) => { mockFiles.delete(key); },
} }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}) }));
const mockInstances: any[] = [];
const mockOptions: any[] = [];
jest.mock('posthog-react-native', () => {
    const actual = jest.requireActual('posthog-react-native');
    return { ...actual, PostHog: jest.fn().mockImplementation((key, options) => {
        const instance = new actual.PostHog(key, options);
        mockInstances.push(instance); mockOptions.push(options);
        return instance;
    }) };
});
import { captureEvent, chooseAnalytics, setAnalyticsUser, startAnalytics } from '../src/lib/analytics/client';
async function bodyOf(init: RequestInit) {
    if (typeof init.body === 'string') return JSON.parse(init.body);
    // Depending on the runtime, the SDK sends a gzip Buffer or a gzip Blob.
    const body = init.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer()) : init.body;
    return JSON.parse(require('zlib').gunzipSync(body).toString());
}
// Exercise the installed SDK's queue, identity envelopes and surviving AppState listeners.
test('lazy SDK, safe identity, flags off and permanent revocation', async () => {
    jest.useFakeTimers();
    const network = jest.fn(async (_url: any, _init?: any) => new Response('{}', { status: 200 }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = network;
    const listeners: Array<(state: any) => void> = [];
    const appState = jest.spyOn(AppState, 'addEventListener').mockImplementation((_, fn) => { listeners.push(fn); return { remove: jest.fn() }; });
    const url = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('veyrnox://job/private-user-id?token=secret#private');
    try {
        delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
        await startAnalytics();
        expect(mockInstances).toHaveLength(0);
        process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
        await startAnalytics();
        await chooseAnalytics('denied');
        expect(mockInstances).toHaveLength(0);
        setAnalyticsUser('opaque-user-1');
        await chooseAnalytics('granted');
        await startAnalytics();
        expect(mockInstances).toHaveLength(1);
        const old = mockInstances[0], options = mockOptions[0];
        expect(options).toMatchObject({ host: expect.stringMatching(/\/ingest$/), captureAppLifecycleEvents: false, persistence: 'file', enableSessionReplay: false, disableRemoteFeatureFlags: true, disableSurveys: true, preloadFeatureFlags: false });
        expect(options).not.toHaveProperty('disableRemoteConfig');
        expect(url).not.toHaveBeenCalled();
        expect(network.mock.calls.map(call => call[0])).toEqual([]);
        await old.flush();
        expect(network.mock.calls.map(call => ({ url: call[0], body: typeof call[1]?.body }))).toEqual(expect.arrayContaining([expect.objectContaining({ body: expect.stringMatching(/string|object/) })]));
        const batches = await Promise.all(network.mock.calls.map(call => bodyOf(call[1])));
        const identity = batches.flatMap(batch => batch.batch ?? []).find(event => event.event === '$identify');
        expect(identity).toBeDefined();
        expect(identity.distinct_id ?? identity.properties.distinct_id).toBe('opaque-user-1');
        expect(identity.properties.$anon_distinct_id).toEqual(expect.any(String));
        expect(identity.properties.$anon_distinct_id).not.toBe('opaque-user-1');
        const payload = JSON.stringify(batches);
        expect(payload).toContain('$identify');
        expect(payload).toContain('opaque-user-1');
        expect(payload).toContain('$anon_distinct_id');
        expect(payload).not.toMatch(/private-user-id|token=secret|\$set|\$set_once|Application Opened/);
        expect(payload).toContain('app_opened');
        const reset = jest.spyOn(old, 'reset'), identify = jest.spyOn(old, 'identify');
        setAnalyticsUser('opaque-user-2');
        expect(reset).toHaveBeenCalledTimes(1);
        expect(identify).toHaveBeenLastCalledWith('opaque-user-2');
        expect(reset.mock.invocationCallOrder[0]).toBeLessThan(identify.mock.invocationCallOrder[0]);
        setAnalyticsUser(null);
        expect(reset).toHaveBeenCalledTimes(2);
        await old.flush();
        expect(network.mock.calls.every(call => String(call[0]) === `${options.host}/batch/`)).toBe(true);
        const optedOut = jest.spyOn(old, 'optOut');
        captureEvent('generation_submitted', { kind: 'image', model_id: 'old-model' });
        let finishWrite!: () => void;
        mockSet.mockImplementationOnce((key, value) => new Promise<void>(resolve => {
            finishWrite = () => { mockFiles.set(key, value); resolve(); };
        }));
        const pendingWrite = options.customStorage.setItem('in-flight', 'old-private-state');
        network.mockClear(); mockSet.mockClear();
        const declining = chooseAnalytics('denied');
        await Promise.resolve();
        // Even an in-flight asynchronous write must settle before deletion.
        finishWrite();
        await pendingWrite;
        await declining;
        expect(optedOut).toHaveBeenCalled();
        expect(reset).toHaveBeenCalledTimes(3);
        expect(mockFiles.size).toBe(0);
        setAnalyticsUser('must-not-identify-before-regrant');
        expect(identify).toHaveBeenCalledTimes(1);
        listeners.forEach(fn => fn('background'));
        listeners.forEach(fn => fn('active'));
        await options.customStorage.setItem('delayed', 'private');
        await old.flush();
        await jest.advanceTimersByTimeAsync(1000);
        expect(network).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
        await chooseAnalytics('granted');
        expect(mockInstances).toHaveLength(2);
        captureEvent('generation_submitted', { kind: 'image', model_id: 'new-model' });
        await old.flush();
        await mockInstances[1].flush();
        const fresh = JSON.stringify(await Promise.all(network.mock.calls.map(call => call[1]?.body ? bodyOf(call[1]) : { url: call[0] })));
        expect(fresh).toContain('new-model');
        expect(fresh).not.toContain('old-model');
        expect(fresh).not.toContain('opaque-user-1');
        expect(new Headers(network.mock.calls[0][1].headers).has('x-veyrnox-analytics-instance')).toBe(false);
    } finally {
        await chooseAnalytics('denied');
        globalThis.fetch = originalFetch;
        appState.mockRestore(); url.mockRestore();
        delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
        jest.useRealTimers();
    }
});
