import { tokensForScheme } from '../src/theme';
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
test('a listed succeeded row with no file says unavailable immediately', async () => {
    await render([{ ...row('a', 'succeeded'), has_asset: false }]);
    expect(text(t('library.fileUnavailable'))).toHaveLength(1); expect(mockMedia.getAsset).not.toHaveBeenCalled();
});
const noRetention = () => {
    expect(text(t('library.fileUnavailable'))).toHaveLength(0);
    expect(text(t('library.keptDefault'))).toHaveLength(0);
    expect(root.container.queryAll(n => n.children.some(c => typeof c === 'string' && /File expires|Retention ended/.test(c)))).toHaveLength(0);
};
test.each([undefined, '2099-01-01'])('a promoted row hides retention until its pending lookup returns a file (%s)', async asset_expires_at => {
    let resolve!: (value: { url: string; mime_type: string; asset_expires_at?: string }) => void;
    mockMedia.getAsset.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await render(); await tick();
    expect(mockList.data[0].state).toBe('succeeded'); noRetention();
    await act(async () => resolve({ ...file, asset_expires_at }));
    if (!asset_expires_at) expect(text(t('library.keptDefault'))).toHaveLength(1);
    else expect(root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.startsWith('File expires')))).toHaveLength(1);
    expect(text(t('library.fileUnavailable'))).toHaveLength(0);
});
test('a promoted row has no retention line during cooldown or after a failed lookup, then shows the file notice', async () => {
    mockMedia.getAsset.mockRejectedValueOnce(new ApiError(429, 'rate_limited', { retryAfterSeconds: 60 }))
        .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ url: file.url, mime_type: file.mime_type });
    await render(); await tick(); noRetention();
    await tick(57_000); noRetention(); expect(mockMedia.getAsset).toHaveBeenCalledTimes(1);
    await tick(); noRetention(); expect(mockMedia.getAsset).toHaveBeenCalledTimes(2);
    await tick(); expect(text(t('library.keptDefault'))).toHaveLength(1);
});
test.each(['refresh', 'older'] as const)('a replacement list row establishes retention after %s', async source => {
    mockMedia.getAsset.mockRejectedValue(new Error('offline'));
    await render([row('a')], { before: 'date', before_id: 'a' }); await tick(); noRetention();
    mockMedia.listJobs.mockResolvedValueOnce({ jobs: [{ ...row('a', 'succeeded'), has_asset: false }], next: null });
    await act(async () => source === 'refresh' ? mockList.onRefresh() : mockList.onEndReached());
    expect(text(t('library.fileUnavailable'))).toHaveLength(1);
});
test('account change clears retention uncertainty for the same id', async () => {
    mockMedia.getAsset.mockRejectedValue(new Error('offline')); await render(); await tick(); noRetention();
    const refresh = mockList.onRefresh; await act(async () => mockAccountChanged());
    mockMedia.listJobs.mockResolvedValueOnce({ jobs: [{ ...row('a', 'succeeded'), has_asset: false }], next: null });
    await act(async () => refresh()); expect(text(t('library.fileUnavailable'))).toHaveLength(1);
});
test('one Library timer updates the mounted notice to urgent and is cleared on unmount', async () => {
    const intervals = jest.spyOn(globalThis, 'setInterval');
    const clear = jest.spyOn(globalThis, 'clearInterval');
    const date = new Date(Date.now() + 7 * 86_400_000 + 30_000);
    await render([{ ...row('a', 'succeeded'), asset_expires_at: date.toISOString() }]);
    const notice = () => root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.startsWith('File expires')))[0];
    const before = RN.StyleSheet.flatten(notice().props.style).color;
    await tick(60_000); expect(before).toBe(tokensForScheme('light').textTertiary);
    expect(RN.StyleSheet.flatten(notice().props.style).color).toBe(tokensForScheme('light').danger);
    const timerIndex = intervals.mock.calls.findIndex(([, ms]) => ms === 60_000);
    expect(timerIndex).toBeGreaterThanOrEqual(0);
    const timer = intervals.mock.results[timerIndex].value;
    await act(async () => root.unmount()); expect(clear).toHaveBeenCalledWith(timer);
    intervals.mockRestore(); clear.mockRestore();
});
