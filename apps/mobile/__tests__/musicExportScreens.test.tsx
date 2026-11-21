import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import ExportAudio from '../src/app/(app)/music/export';
import { MusicSongActions } from '../src/components/music/MusicSongActions';
import { shareStemFile } from '../src/lib/music/stemFiles';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { resetNetworkState } from '../src/lib/network';
import { t, plural } from '../src/lib/i18n';
import { quote, start, file, exportSong, response } from './fixtures/musicExport';
const mockApi = { request: jest.fn() }, mockPush = jest.fn();
jest.mock('../src/lib/music/stemFiles', () => ({ shareStemFile: jest.fn(async () => {}) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }),
    useLocalSearchParams: () => ({ id: '11111111-2222-4333-8444-555555555555' }) }));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView];
let root: Root;
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const control = (role: string, label?: string) => root.container.queryAll(n => n.props.accessibilityRole === role && (!label || n.props.accessibilityLabel === label))[0];
const button = (key: string) => control('button', t(key));
const click = async (key: string) => { await act(async () => button(key).props.onClick({ nativeEvent: {} })); };
const mount = async () => { await act(async () => root.render(<ExportAudio />)); };
const ready = async () => { await mount(); await click('musicExport.review'); await click('musicExport.confirm'); };
beforeEach(async () => {
    resetCacheUser(); resetNetworkState(); await bindCacheUser('export-screen-user'); jest.clearAllMocks(); mockApi.request.mockReset().mockImplementation(response);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot();
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); resetNetworkState(); });
test('three accessible formats, current source, free review and invalidation without starting', async () => {
    await mount(); expect(control('radiogroup')).toBeDefined();
    expect(control('radio', 'MP3').props.accessibilityState.checked).toBe(true);
    for (const format of ['MP3', 'WAV', 'FLAC']) {
        const radio = control('radio', format); expect(RN.StyleSheet.flatten(radio.props.style).minHeight).toBeGreaterThanOrEqual(44);
        await act(async () => radio.props.onClick({ nativeEvent: {} }));
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'radio' && n.props.accessibilityState.checked)).toHaveLength(1);
    }
    await click('musicExport.review'); expect(button('musicExport.confirm')).toBeDefined();
    expect(text(t('musicExport.quoteFormat', { format: 'FLAC' })).length).toBeGreaterThan(0);
    expect(text(t('musicExport.freeReview')).length).toBeGreaterThan(0);
    expect(mockApi.request.mock.calls.filter(([p]) => p.endsWith('/exports'))).toHaveLength(0);
    await act(async () => control('radio', 'WAV').props.onClick({ nativeEvent: {} })); expect(button('musicExport.confirm')).toBeUndefined();
});
test.each([true, false])('review explains consumes_allowance=%s without credit wording', async consumes => {
    mockApi.request.mockImplementation((p, init) => p.endsWith('/export-quotes')
        ? { quote: { ...quote, consumes_allowance: consumes, remaining_after: consumes ? 4 : 5 } } : response(p, init));
    await mount(); await click('musicExport.review');
    expect(text(t(consumes ? 'musicExport.consumes' : 'musicExport.claimed')).length).toBeGreaterThan(0);
    expect(text(t('musicExport.usage', { used: 2, total: 7 })).length).toBeGreaterThan(0);
    expect(text(t('musicExport.after', { count: consumes ? 4 : 5 })).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.children.some(c => typeof c === 'string' && /credit|balance|spend/i.test(c)))).toHaveLength(0);
});
test('dismissal/cancel makes no saved claim, leaves Save enabled and repeats one GET and transfer without POST', async () => {
    await ready(); expect(text(plural('musicExport.remaining', 4)).length).toBeGreaterThan(0);
    await click('musicExport.save'); expect(text(t('musicExport.closed')).length).toBeGreaterThan(0);
    expect(button('musicExport.save').props.accessibilityState.disabled).toBe(false);
    expect(root.container.queryAll(n => n.children.some(c => typeof c === 'string' && /saved|success/i.test(c)))).toHaveLength(0);
    mockApi.request.mockClear(); jest.mocked(shareStemFile).mockClear();
    mockApi.request.mockResolvedValueOnce({ export: { ...file, url: 'https://signed.test/fresh' } });
    await click('musicExport.save'); expect(mockApi.request.mock.calls).toEqual([[`/api/v1/music/exports/${start.export.id}`, undefined, { timeoutMs: 30000 }]]);
    expect(shareStemFile).toHaveBeenCalledTimes(1); expect(shareStemFile).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://signed.test/fresh', kind: 'export' }));
});
test.each(['quote', 'start'])('allowance 402 at %s displays allowance copy without purchases', async stage => {
    await mount(); if (stage === 'start') await click('musicExport.review');
    mockApi.request.mockImplementation((p, init) => p.endsWith(stage === 'quote' ? '/export-quotes' : '/exports')
        ? Promise.reject(new ApiError(402, 'download_allowance_exhausted')) : response(p, init));
    await click(stage === 'quote' ? 'musicExport.review' : 'musicExport.confirm');
    expect(text(t('musicExport.exhausted')).length).toBeGreaterThan(0); expect(mockPush).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.children.some(c => typeof c === 'string' && /credit|balance|purchase/i.test(c)))).toHaveLength(0);
});
test.each([
    [409, 'render_required', 'render'], [409, 'quote_expired', 'expired'], [503, 'format_unavailable', 'formatUnavailable'],
    [404, 'not_found', 'missing'], [0, 'network', 'offline'], [503, 'temporarily_unavailable', 'error'],
    [404, 'music_distribution_unavailable', 'off'],
])('%s %s shows plain copy', async (status, code, key) => {
    await mount(); mockApi.request.mockResolvedValueOnce(exportSong).mockRejectedValueOnce(new ApiError(Number(status), String(code)));
    await click('musicExport.review'); expect(text(t(`musicExport.${key}`)).length).toBeGreaterThan(0);
    expect(text(String(code))).toHaveLength(0);
});
test('failed Save keeps the same export and enables retry', async () => {
    await ready(); jest.mocked(shareStemFile).mockRejectedValueOnce(new ApiError(0, 'stem_share_failed'));
    await click('musicExport.save'); expect(text(t('musicExport.transfer')).length).toBeGreaterThan(0);
    mockApi.request.mockClear(); await click('musicExport.save');
    expect(mockApi.request).toHaveBeenCalledTimes(1); expect(mockApi.request.mock.calls[0][0]).toContain(start.export.id);
});
test('entry visibility and route; call-time distribution off hides it without altering share links', async () => {
    const render = async (song = exportSong) => { await act(async () => root.render(<><MusicSongActions song={song} /><ExportAudio /></>)); };
    await render(); await click('musicExport.title'); expect(mockPush).toHaveBeenCalledWith({ pathname: '/music/export', params: { id: exportSong.id } });
    await render({ ...exportSong, lifecycle_status: 'trashed' });
    expect(button('musicExport.title')).toBeUndefined();
    await render({ ...exportSong, actions: ['share_link'] }); expect(button('musicExport.title')).toBeUndefined();
    await render(); mockApi.request.mockResolvedValueOnce(exportSong).mockRejectedValueOnce(new ApiError(404, 'music_distribution_unavailable'));
    await click('musicExport.review'); expect(button('musicExport.title')).toBeUndefined();
});
test('StrictMode and account replacement create live screen flows', async () => {
    await act(async () => root.render(<StrictMode><ExportAudio /></StrictMode>));
    expect(button('musicExport.review')).toBeDefined();
    await act(async () => bindCacheUser('another-user')); await click('musicExport.review'); expect(button('musicExport.confirm')).toBeDefined();
});
