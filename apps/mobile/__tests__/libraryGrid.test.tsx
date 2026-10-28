import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Library from '../src/app/(app)/(tabs)/library';
import { ApiError } from '../src/lib/api';
import type { Job } from '../src/lib/media';
import { t } from '../src/lib/i18n';
const mockApi = {};
const mockMedia = { listJobs: jest.fn(), getJob: jest.fn(), getAsset: jest.fn() };
const mockPlayer = { pause: jest.fn(), play: jest.fn(), replaceAsync: jest.fn().mockResolvedValue(undefined), muted: true };
let mockAccountChanged: () => void;
let mockList: any;
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }), useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer }));
jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement(require('react-native').View, { ...props, testID: 'media-image' }) }));
jest.mock('../src/lib/videoPoster', () => ({ clearPosters: jest.fn(), posterFor: jest.fn().mockResolvedValue(null) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: (cb: any) => { mockAccountChanged = cb; return () => {}; }, appCache: { read: async () => null, swr: async ({ fetcher, onData }: any) => { const page = await fetcher(); onData(page); return { meta: null }; } } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), mediaApi: () => mockMedia, fetchCatalogCached: async (cb: any) => cb([{ id: 'm', name: 'Model', modality: 'text-to-image' }]) }));
jest.mock('react-native/Libraries/Lists/FlatList', () => ({ __esModule: true, default: (props: any) => {
    mockList = props; const React = require('react'); const { View } = require('react-native');
    return React.createElement(View, null, props.ListHeaderComponent, ...props.data.map((item: Job) => React.createElement(View, { key: item.job_id }, props.renderItem({ item }))), props.ListFooterComponent);
} }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator];
let root: Root;
const row = (id: string, state: Job['state'] = 'queued'): Job => ({ job_id: id, state, credits: 3, model_id: 'm', created_at: '2026-10-28', has_asset: state === 'succeeded' });
const file = { url: 'https://file', mime_type: 'image/png', asset_expires_at: '2099-01-01' };
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
async function tick(ms = 3000) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
async function render(rows: Job[] = [row('a')], next: any = null) { mockMedia.listJobs.mockResolvedValueOnce({ jobs: rows, next }); await act(async () => root.render(<Library />)); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks();
    Object.defineProperty(RN.AppState, 'currentState', { configurable: true, value: 'active' });
    mockMedia.getJob.mockResolvedValue({ state: 'succeeded', credits: 3, model_id: 'm' }); mockMedia.getAsset.mockResolvedValue(file); root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
test('grid is default; visible completed image requests one link with generated attribution', async () => {
    const image = row('a', 'succeeded'); await render([image]); expect(mockList.numColumns).toBe(2);
    await act(async () => { mockList.onViewableItemsChanged({ viewableItems: [{ item: image }] }); mockList.onViewableItemsChanged({ viewableItems: [{ item: image }] }); });
    expect(mockMedia.getAsset).toHaveBeenCalledTimes(1); expect(text(t('libraryCreate.generated')).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.testID === 'media-image').length).toBeGreaterThan(0);
});
test('held lookup displays Under review', async () => {
    const image = row('a', 'succeeded'); mockMedia.getAsset.mockRejectedValue(new ApiError(404, 'held')); await render([image]);
    await act(async () => mockList.onViewableItemsChanged({ viewableItems: [{ item: image }] }));
    expect(text(t('library.status.held')).length).toBeGreaterThan(0);
});
test('a queued job on page two resolves through its asset endpoint without refreshing the list', async () => {
    await render([row('a', 'succeeded')], { before: 'date', before_id: 'a' });
    mockMedia.listJobs.mockResolvedValueOnce({ jobs: [row('b')], next: null }); await act(async () => mockList.onEndReached());
    await tick(); expect(mockMedia.getAsset).toHaveBeenCalledWith('b'); expect(mockMedia.listJobs).toHaveBeenCalledTimes(2);
    expect(mockList.data.find((j: Job) => j.job_id === 'b')).toMatchObject({ state: 'succeeded', has_asset: true, asset_expires_at: '2099-01-01' });
});
test('none is retried next tick and resolves automatically', async () => {
    mockMedia.getAsset.mockRejectedValueOnce(new Error('not yet')); await render(); await tick(); await tick();
    expect(mockMedia.getAsset).toHaveBeenCalledTimes(2); expect(mockList.data[0].has_asset).toBe(true);
});
test('a 60 second cooldown sends no lookup and does not trigger the twenty-failure banner', async () => {
    mockMedia.getAsset.mockRejectedValueOnce(new ApiError(429, 'rate_limited', { retryAfterSeconds: 60 })); await render(); await tick();
    await tick(57000); expect(mockMedia.getAsset).toHaveBeenCalledTimes(1); expect(text(t('libraryCreate.unreachable'))).toHaveLength(0);
    await tick(); expect(mockMedia.getAsset).toHaveBeenCalledTimes(2); expect(mockList.data[0].has_asset).toBe(true);
});
test('twenty failing ticks stop requests; Retry resumes; account change stops and clears', async () => {
    mockMedia.getJob.mockRejectedValue(new Error('offline')); await render(); await tick(60000);
    expect(text(t('libraryCreate.unreachable'))).toHaveLength(1); expect(mockMedia.getJob).toHaveBeenCalledTimes(20);
    await tick(6000); expect(mockMedia.getJob).toHaveBeenCalledTimes(20);
    const retry = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t('recovery.retry'))[0];
    await act(async () => retry.props.onClick({ nativeEvent: {} })); await tick(); expect(mockMedia.getJob).toHaveBeenCalledTimes(21);
    await act(async () => mockAccountChanged()); await tick(6000); expect(mockMedia.getJob).toHaveBeenCalledTimes(21);
    expect(text(t('libraryCreate.generated'))).toHaveLength(0);
});
test('failed Show older is visible with Retry', async () => {
    await render([], { before: 'date', before_id: 'a' }); mockMedia.listJobs.mockRejectedValueOnce(new Error('offline'));
    await act(async () => mockList.onEndReached()); expect(text(t('libraryCreate.olderFailed'))).toHaveLength(1);
});
