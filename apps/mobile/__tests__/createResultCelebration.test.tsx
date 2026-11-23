import { act } from 'react';
import * as RN from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createRoot, type Root } from 'test-renderer';
import { CreateResult, type ResultBatch } from '../src/components/create/CreateResult';
import JobScreen from '../src/app/(app)/job/[id]';
import { celebrateFinished, noteLocalSubmission, resetCelebrations, settleMilestones } from '../src/lib/celebrate';
import { onCelebrate, type CelebrationEvent } from '../src/lib/veyMotion';
import { bindCacheUser, wipeCache } from '../src/lib/appCache';
import type { ApiClient } from '../src/lib/api';
import type { Job } from '../src/lib/media';

jest.mock('expo-secure-store', () => ({ getItem: jest.fn(() => null), setItem: jest.fn() }));
jest.mock('../src/lib/appCache', () => {
    let owner: string | undefined = 'a';
    const listeners = new Set<() => void>();
    return {
        getCacheUser: () => owner,
        bindCacheUser: async (next: string) => { owner = next; listeners.forEach(fn => fn()); },
        wipeCache: async () => { owner = undefined; listeners.forEach(fn => fn()); },
        subscribeCacheUser: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    };
});
const mockApi = { request: jest.fn(async () => ({ jobs: [], next: null })) };
const mockAsset = { url: 'https://example.test/result.png', mime_type: 'image/png' };
const mockMedia = { getAsset: jest.fn(async () => mockAsset), getJob: jest.fn(async () => ({ state: 'succeeded', model_id: 'm' })) };
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockNavigation = { addListener: () => () => {} };
const mockResults = new Map<string, object>();
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({
    Stack: { Screen: () => null }, Link: () => null,
    useLocalSearchParams: () => ({ id: 'one', fromCreate: '1' }),
    useRouter: () => mockRouter, useNavigation: () => mockNavigation,
    useFocusEffect: (fn: () => () => void) => jest.requireActual('react').useEffect(fn, [fn]),
}));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('../src/components/JobProvenance', () => ({ JobProvenance: () => null }));
jest.mock('../src/components/StemList', () => ({ StemList: () => null }));
jest.mock('../src/components/InlineMedia', () => ({ InlineMedia: () => null }));
jest.mock('../src/components/GenerationProgress', () => ({ GenerationProgress: () => null }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('../src/components/library/GeneratedChip', () => ({ GeneratedChip: () => null }));
jest.mock('../src/lib/output', () => ({ saveOutput: jest.fn(), shareOutput: jest.fn() }));
jest.mock('../src/lib/storeReview', () => ({ loadReviewAsk: async () => null }));
jest.mock('../src/lib/media', () => ({
    ...jest.requireActual('../src/lib/media'), mediaApi: () => mockMedia,
    waitForJob: async (_api: unknown, _id: string, update: (state: string) => void) => {
        update('running'); update('succeeded'); return 'succeeded';
    },
}));
jest.mock('../src/lib/milestoneHistory', () => ({ settleFirstMilestones: (...args: unknown[]) => mockMilestones(...args) }));
const mockMilestones = jest.fn(async (..._args: unknown[]) => {});
jest.mock('../src/lib/createResult', () => ({ useJobResult: (_api: unknown, id: string) => mockResults.get(id), soundPassFor: () => null }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Image];
const batch = (ids = ['one']): ResultBatch => ({ ids, modelId: 'm', kind: 'image', aspect: '1:1', duration: null, count: ids.length });
const job = (id: string): Job => ({ job_id: id, state: 'succeeded', credits: 1, model_id: 'm', has_asset: true, created_at: new Date().toISOString() });
let root: Root, off: () => void, events: CelebrationEvent[];
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    jest.clearAllMocks();
    await bindCacheUser('a');
    resetCelebrations();
    settleMilestones({ creation: true, video: true });
    mockMilestones.mockReset().mockResolvedValue(undefined);
    mockResults.clear();
    for (const id of ['one', 'two']) mockResults.set(id, { state: 'succeeded', job: { refunded: false }, asset: { ...mockAsset } });
    mockResults.set('failed', { state: 'failed', job: { refunded: true, credits: 1 }, asset: null });
    events = [];
    off = onCelebrate(event => { events.push(event); event.onShown(); });
    root = createRoot();
});
afterEach(async () => {
    await act(async () => root.unmount());
    events.forEach(event => event.onDone());
    off();
    jest.useRealTimers();
});
async function renderCreate(ids = ['one']) {
    await act(async () => root.render(<CreateResult api={mockApi as unknown as ApiClient} batch={batch(ids)} catalog={[]} onTerminal={() => {}} />));
}

test('CreateResult handles every ready job once, including assets ready at mount, and excludes a failed batch member', async () => {
    await renderCreate(['one', 'two', 'failed']);
    expect(events.map(event => event.kind)).toEqual(['success', 'success']);
    expect(mockMilestones).toHaveBeenCalledTimes(2);
    await renderCreate(['one', 'two', 'failed']);
    expect(events).toHaveLength(2);
    // A fresh asset object from another poll cannot replay the same completion.
    mockResults.set('one', { state: 'succeeded', job: {}, asset: { ...mockAsset } });
    await renderCreate(['one', 'two', 'failed']);
    expect(mockMilestones).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(2);
});

test.each(['Home', 'job screen', 'CreateResult'])('%s wins the claim; the other two paths cannot celebrate the same job', async (first) => {
    noteLocalSubmission('one');
    const home = async () => { await act(async () => { celebrateFinished([job('one')], async () => mockAsset); }); };
    const detail = async () => { await act(async () => root.render(<JobScreen />)); };
    const paths = { Home: home, 'job screen': detail, CreateResult: () => renderCreate() };
    await paths[first as keyof typeof paths]();
    expect(events.map(event => event.kind)).toEqual(['success']);
    for (const [name, visit] of Object.entries(paths)) if (name !== first) await visit();
    await home();
    expect(events.map(event => event.kind)).toEqual(['success']);
});

test.each(['unmount', 'account change'])('CreateResult cancels its pending milestone continuation on %s', async (reason) => {
    let resolve!: () => void;
    mockMilestones.mockImplementation(() => new Promise<void>(r => { resolve = r; }));
    await renderCreate();
    expect(mockMilestones).toHaveBeenCalledTimes(1);
    const writes = (SecureStore.setItem as jest.Mock).mock.calls.length;
    if (reason === 'unmount') await act(async () => root.unmount());
    else await act(async () => { await wipeCache(); await bindCacheUser('b'); });
    await act(async () => resolve());
    expect(events).toEqual([]);
    const lateWrites = (SecureStore.setItem as jest.Mock).mock.calls.slice(writes);
    expect(lateWrites.filter(([key]) => /celebrate\.(first|video)\./.test(key))).toEqual([]);
});

test('an api identity change preserves a pending celebration and later jobs use the latest api', async () => {
    let resolve!: () => void;
    mockMilestones.mockImplementationOnce(() => new Promise<void>(r => { resolve = r; }));
    await renderCreate();
    const nextApi = { request: jest.fn() } as unknown as ApiClient;
    await act(async () => root.render(<CreateResult api={nextApi} batch={batch()} catalog={[]} onTerminal={() => {}} />));
    expect(mockMilestones).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
    expect(events.map(event => event.kind)).toEqual(['success']);
    await act(async () => root.render(<CreateResult api={nextApi} batch={batch(['one', 'two'])} catalog={[]} onTerminal={() => {}} />));
    expect(mockMilestones).toHaveBeenCalledTimes(2);
    expect(mockMilestones.mock.calls[1][0]).toBe(nextApi);
    expect(events).toHaveLength(2);
});
