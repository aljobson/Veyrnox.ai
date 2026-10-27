export {};
jest.setTimeout(30_000);
const mockFiles = new Map<string, string>();
const mockInstances: any[] = [];
jest.mock('../src/lib/appCache', () => ({ appStorage: {
    get: async (key: string) => mockFiles.get(key) ?? null,
    set: async (key: string, value: string) => { mockFiles.set(key, value); },
    keys: async () => [...mockFiles.keys()], remove: async (key: string) => { mockFiles.delete(key); },
} }));
jest.mock('expo-secure-store', () => ({
    getItemAsync: async () => JSON.stringify({ v: 1, choice: 'granted', at: 1 }),
    setItemAsync: jest.fn(async () => {}),
}));
jest.mock('posthog-react-native', () => {
    const actual = jest.requireActual('posthog-react-native');
    return { ...actual, PostHog: jest.fn().mockImplementation((key, options) => {
        const instance = new actual.PostHog(key, options);
        mockInstances.push(instance);
        jest.spyOn(instance, 'reset'); jest.spyOn(instance, 'identify');
        return instance;
    }) };
});

test('signed-out cold starts retain the persisted anonymous identity', async () => {
    const original = globalThis.fetch;
    const network = jest.fn(async () => new Response('{}', { status: 200 }));
    jest.useFakeTimers();
    process.env.EXPO_PUBLIC_POSTHOG_KEY = 'phc_test';
    try {
        globalThis.fetch = network;
        await require('../src/lib/analytics/client').startAnalytics();
        const first = mockInstances[0];
        const id = first.getDistinctId();
        await first.flush();
        await jest.advanceTimersByTimeAsync(2000);
        expect(mockFiles.size).toBeGreaterThan(0);
        expect(first.reset).not.toHaveBeenCalled();
        expect(first.identify).not.toHaveBeenCalled();
        // Simulate a process restart while retaining only durable storage.
        jest.clearAllTimers(); jest.resetModules(); globalThis.fetch = network;
        await require('../src/lib/analytics/client').startAnalytics();
        const second = mockInstances[1];
        expect(second.getDistinctId()).toBe(id);
        expect(second.reset).not.toHaveBeenCalled();
        expect(second.identify).not.toHaveBeenCalled();
    } finally {
        await require('../src/lib/analytics/client').chooseAnalytics('denied');
        globalThis.fetch = original;
        delete process.env.EXPO_PUBLIC_POSTHOG_KEY;
        jest.useRealTimers();
    }
});
