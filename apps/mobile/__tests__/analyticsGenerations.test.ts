const mockFiles = new Map<string, string>();
let mockChoice: string | null = 'granted';
let mockGrant = 1;
let mockOwner: string | undefined = 'owner';
const mockCapture = jest.fn();
const mockRead = jest.fn(async (key: string) => mockFiles.get(key) ?? null);
jest.mock('../src/lib/analytics/events', () => ({ captureEvent: (...args: unknown[]) => mockCapture(...args) }));
jest.mock('../src/lib/analytics/consent', () => ({ getAnalyticsChoice: () => mockChoice, getConsentTimestamp: () => mockGrant, isAnalyticsEnabled: () => true }));
jest.mock('../src/lib/network', () => ({ ensureOnline: jest.fn(async () => {}), observe: jest.fn() }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: jest.fn(async () => {}), hasAgreed: jest.fn(async () => true) } }));
jest.mock('../src/lib/celebrate', () => ({ noteLocalSubmission: jest.fn() }));
jest.mock('../src/lib/appCache', () => ({
    getCacheUser: () => mockOwner,
    appStorage: { get: (...args: [string]) => mockRead(...args), set: async (key: string, value: string) => { mockFiles.set(key, value); }, remove: async (key: string) => { mockFiles.delete(key); } },
}));
const load = () => require('../src/lib/analytics/generations');
beforeEach(() => { jest.resetModules(); mockFiles.clear(); mockCapture.mockClear(); mockRead.mockClear(); mockChoice = 'granted'; mockGrant = 1; mockOwner = 'owner'; });
test('completion survives restart, deduplicates and never sends job IDs', async () => {
    await load().noteGenerationSubmitted('private-job-id', 'flux-1', 'image');
    jest.resetModules();
    await load().noteGenerationFinished('private-job-id', 'succeeded');
    jest.resetModules();
    await load().noteGenerationFinished('private-job-id', 'succeeded');
    await load().noteGenerationSubmitted('private-job-id', 'flux-1', 'image');
    expect(mockCapture.mock.calls).toEqual([
        ['generation_submitted', { kind: 'image', model_id: 'flux-1' }],
        ['generation_finished', { kind: 'image', outcome: 'succeeded' }],
    ]);
    expect(JSON.stringify(mockCapture.mock.calls)).not.toContain('private-job-id');
});
test('decline, re-grant and account changes cannot report previous jobs', async () => {
    await load().noteGenerationSubmitted('old', 'flux-1', 'image');
    mockCapture.mockClear(); mockChoice = 'denied';
    await load().noteGenerationFinished('old', 'failed');
    mockChoice = 'granted'; mockGrant = 2;
    await load().noteGenerationFinished('old', 'failed');
    mockGrant = 1; mockOwner = 'another-owner';
    await load().noteGenerationFinished('old', 'failed');
    expect(mockCapture).not.toHaveBeenCalled();
});
test('a delayed read after revocation cannot emit a completion', async () => {
    await load().noteGenerationSubmitted('old', 'flux-1', 'image');
    mockCapture.mockClear();
    let resolve!: (value: string) => void;
    mockRead.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const finish = load().noteGenerationFinished('old', 'cancelled');
    await Promise.resolve();
    mockChoice = 'denied'; resolve('{"kind":"image"}'); await finish;
    expect(mockCapture).not.toHaveBeenCalled();
});

test('generation submission and completion do not wait for analytics storage', async () => {
    const { mediaApi, waitForJob } = require('../src/lib/media');
    mockRead.mockImplementation(() => new Promise(() => {}));
    try {
        const request = jest.fn().mockResolvedValue({ job_id: 'new-job' });
        const api = mediaApi({ request });
        await expect(api.createGeneration({
            modelId: 'flux-1', analyticsKind: 'image', prompt: 'private',
            durationSeconds: null, confirmedCredits: 1, idempotencyKey: 'key',
        })).resolves.toEqual({ job_id: 'new-job' });
        expect(mockRead).toHaveBeenCalledWith(expect.stringContaining('new-job'));
        request.mockResolvedValue({ state: 'succeeded' });
        await expect(waitForJob(api, 'finished-job', jest.fn(), new AbortController().signal)).resolves.toBe('succeeded');
        expect(mockRead).toHaveBeenCalledWith(expect.stringContaining('finished-job'));
        expect(mockCapture).not.toHaveBeenCalled();
    } finally { mockRead.mockImplementation(async key => mockFiles.get(key) ?? null); }
});
