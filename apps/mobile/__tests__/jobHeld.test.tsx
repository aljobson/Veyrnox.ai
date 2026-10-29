import { tokensForScheme } from '../src/theme';
import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import JobScreen from '../src/app/(app)/job/[id]';
import { ApiError } from '../src/lib/api';
import { formatLocale, t } from '../src/lib/i18n';
const mockClient = {};
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockClient }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: () => null, useLocalSearchParams: () => ({ id: mockId }), useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('../src/components/JobProvenance', () => ({ JobProvenance: () => null }));
jest.mock('../src/components/StemList', () => ({ StemList: () => null }));
jest.mock('../src/components/InlineMedia', () => ({ InlineMedia: () => null }));
jest.mock('../src/lib/output', () => ({ saveOutput: jest.fn(), shareOutput: jest.fn() }));
const mockApi = { getJob: jest.fn(), getAsset: jest.fn() };
let mockId = 'held';
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), mediaApi: () => mockApi }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('../src/components/FacelessSoundCard', () => ({ FacelessSoundCard: () => null }));
jest.mock('../src/lib/storeReview', () => ({ loadReviewAsk: async () => null }));
jest.mock('../src/lib/celebrate', () => ({ celebrateOutput: jest.fn(), afterCelebration: jest.fn() }));
void [RN.ActivityIndicator, RN.View, RN.Text, RN.StyleSheet, RN.ScrollView, RN.Pressable];
let root: Root;
const file = { url: 'https://file', mime_type: 'image/png' };
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const notices = () => root.container.queryAll(n => n.children.some(c => typeof c === 'string' && /File unavailable|Generated files|File expires|Retention ended/.test(c)));
async function render() { await act(async () => root.render(<JobScreen />)); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); mockApi.getJob.mockReset(); mockApi.getAsset.mockReset(); mockId = 'held';
    mockApi.getJob.mockResolvedValue({ state: 'succeeded', model_id: 'm' });
    mockApi.getAsset.mockRejectedValue(new ApiError(404, 'held'));
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
test('held output has Under review and Library, never Check again', async () => {
    await act(async () => root.render(<JobScreen />));
    expect(root.container.queryAll(n => n.children.includes(t('library.status.held')))).toHaveLength(1);
    expect(root.container.queryAll(n => n.children.includes(t('job.checkAgain')))).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('label.Library')).length).toBeGreaterThan(0);
    expect(notices()).toHaveLength(0);
});

test('finished file with unknown expiry shows the default notice', async () => {
    mockApi.getAsset.mockResolvedValue(file); await render();
    expect(text(t('library.keptDefault'))).toHaveLength(1);
});
test('a running job has no retention line', async () => {
    mockApi.getJob.mockResolvedValue({ state: 'running', model_id: 'm' }); await render();
    expect(notices()).toHaveLength(0); expect(mockApi.getAsset).not.toHaveBeenCalled();
});
test('a succeeded job waits for the deferred asset lookup before showing a notice', async () => {
    let resolve!: (value: typeof file) => void;
    mockApi.getAsset.mockImplementation(() => new Promise(r => { resolve = r; })); await render();
    expect(text(t('job.succeeded'))).toHaveLength(1); expect(notices()).toHaveLength(0);
    await act(async () => resolve(file)); expect(text(t('library.keptDefault'))).toHaveLength(1);
});
test('502 keeps Check again; retry resets lookup to pending', async () => {
    mockApi.getAsset.mockRejectedValueOnce(new ApiError(502, 'upstream_error')); await render();
    expect(text(t('job.checkError'))).toHaveLength(1); expect(notices()).toHaveLength(0);
    let resolve!: (value: typeof file) => void;
    mockApi.getAsset.mockImplementation(() => new Promise(r => { resolve = r; }));
    const retry = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t('job.checkAgain'))[0];
    await act(async () => retry.props.onClick({ nativeEvent: {} }));
    expect(text(t('job.checkError'))).toHaveLength(0); expect(notices()).toHaveLength(0);
    await act(async () => resolve(file)); expect(text(t('library.keptDefault'))).toHaveLength(1);
});
test('only an asset 404 not_found means the finished file is unavailable', async () => {
    mockApi.getAsset.mockRejectedValue(new ApiError(404, 'not_found')); await render();
    expect(text(t('library.fileUnavailable'))).toHaveLength(1);
    expect(text(t('job.succeeded'))).toHaveLength(1);
    expect(text(t('job.checkError'))).toHaveLength(0); expect(text(t('job.checkAgain'))).toHaveLength(0);
});
test('a poll status 404 stays an error, without waiting or unavailable UI', async () => {
    mockApi.getJob.mockRejectedValue(new ApiError(404, 'not_found')); await render();
    await act(async () => { await jest.advanceTimersByTimeAsync(45_000); });
    expect(text(t('job.checkError'))).toHaveLength(1); expect(text(t('job.checkAgain'))).toHaveLength(1);
    expect(notices()).toHaveLength(0); expect(mockApi.getAsset).not.toHaveBeenCalled();
    expect(text(t('job.stopWaiting'))).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'progressbar')).toHaveLength(0);
});
test('a succeeded job still shows its file and retention notice when the detail lookup fails with 502', async () => {
    mockApi.getJob.mockResolvedValueOnce({ state: 'succeeded', model_id: 'm' })
        .mockRejectedValueOnce(new ApiError(502, 'upstream_error'));
    mockApi.getAsset.mockResolvedValue(file); await render();
    expect(mockApi.getJob).toHaveBeenCalledTimes(2);
    expect(mockApi.getAsset).toHaveBeenCalledWith(mockId);
    expect(root.container.queryAll(n => n.props.source?.uri === file.url).length).toBeGreaterThan(0);
    expect(text(t('library.keptDefault'))).toHaveLength(1);
    expect(text(t('job.checkError'))).toHaveLength(0);
    expect(text(t('job.checkAgain'))).toHaveLength(0);
});
test('changing job id clears the previous file notice while the next lookup is pending', async () => {
    mockApi.getAsset.mockResolvedValueOnce(file); await render();
    expect(text(t('library.keptDefault'))).toHaveLength(1);
    mockId = 'next'; mockApi.getAsset.mockImplementation(() => new Promise(() => {})); await render();
    expect(notices()).toHaveLength(0);
});
test('job notice becomes urgent after a minute without remounting, and clears its timer on unmount', async () => {
    const intervals = jest.spyOn(globalThis, 'setInterval');
    const clear = jest.spyOn(globalThis, 'clearInterval');
    const date = new Date(Date.now() + 7 * 86_400_000 + 30_000);
    mockApi.getAsset.mockResolvedValue({ ...file, asset_expires_at: date.toISOString() }); await render();
    const notice = t('library.expires', { date: date.toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) });
    const before = RN.StyleSheet.flatten(text(notice)[0].props.style).color;
    await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
    expect(before).toBe(tokensForScheme('light').textTertiary);
    expect(RN.StyleSheet.flatten(text(notice)[0].props.style).color).toBe(tokensForScheme('light').danger);
    const timerIndex = intervals.mock.calls.findIndex(([, ms]) => ms === 60_000);
    expect(timerIndex).toBeGreaterThanOrEqual(0);
    const timer = intervals.mock.results[timerIndex].value;
    await act(async () => root.unmount()); expect(clear).toHaveBeenCalledWith(timer);
    intervals.mockRestore(); clear.mockRestore();
});

test.each([[-1, 'library.retentionEnded'], [86_400_000, 'library.expires']] as const)('job dated notice %i uses danger', async (offset, key) => {
    const date = new Date(Date.now() + offset);
    mockApi.getAsset.mockResolvedValue({ ...file, asset_expires_at: date.toISOString() }); await render();
    const notice = t(key, { date: date.toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' }) });
    expect(text(notice)).toHaveLength(1);
    expect(RN.StyleSheet.flatten(text(notice)[0].props.style).color).toBe(tokensForScheme('light').danger);
});
