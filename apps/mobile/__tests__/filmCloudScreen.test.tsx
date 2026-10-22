import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/film/cloud';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { getOpenedFilm, openCloudFilm } from '../src/lib/filmCloud';
import { loadStudio, saveStudio } from '../src/lib/filmStudioStore';
import { plural, t } from '../src/lib/i18n';
declare const __dirname: string;
const { readFileSync } = require('fs'); const { resolve } = require('path');
const source = readFileSync(resolve(__dirname, '../../../app/veyrnox/_lib/filmStudio.js'), 'utf8').replace(/^export /gm, '');
const emptyFilm = new Function(`${source}\nreturn emptyFilm;`)();
const mockRequest = jest.fn(); const mockApi = { request: mockRequest };
const mockDismiss = jest.fn(); const mockReplace = jest.fn();
const mockRouter = { dismissTo: mockDismiss, replace: mockReplace };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
void [RN.ScrollView, RN.Text, RN.Pressable, RN.StyleSheet, RN.ActivityIndicator];
const id = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const row = { id, name: 'Film B', shot_count: 4, revision: 1, updated_at: '2026-10-21T12:00:00Z' };
const second = { ...row, id: secondId, name: 'Film C', updated_at: null };
const raw = (name: string) => JSON.stringify({ ...emptyFilm(), name });
const detail = { project: row, studio_json: raw('Film B') };
const rowLabel = (r = row) => t('filmCloud.rowLabel', { name: r.name, shots: plural('filmCloud.shots', r.shot_count), date: r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '' });
let root: Root;
const has = (text: string) => root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(text))).length > 0;
const buttons = () => root.container.queryAll(n => n.props.accessibilityRole === 'button');
async function press(label = rowLabel()) {
    const button = buttons().find(n => n.props.accessibilityLabel === label)!;
    expect(button).toBeDefined();
    await act(async () => { button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
async function mount() { root = createRoot(); await act(async () => root.render(<Screen />)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); resetCacheUser(); await wipeCache(); await bindCacheUser('alice');
    jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    mockRequest.mockImplementation(async path => path.endsWith(id) ? detail : { projects: [row, second] });
});
afterEach(async () => { if (root) await act(async () => root.unmount()); jest.restoreAllMocks(); resetCacheUser(); });
test('accessible heading, row labels, counts and optional dates', async () => {
    await mount();
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header')).toHaveLength(1);
    expect(buttons()).toHaveLength(2);
    expect(buttons().map(n => n.props.accessibilityLabel)).toEqual([rowLabel(), rowLabel(second as any)]);
    expect(has(t('filmCloud.note'))).toBe(true);
});
test('empty list has neutral copy and no web action', async () => {
    mockRequest.mockResolvedValue({ projects: [] }); await mount();
    expect(has(t('filmCloud.empty'))).toBe(true); expect(has('Continue on web')).toBe(false);
});
test.each([[404, 'filmCloud.unavailable'], [403, 'filmCloud.unavailable'], [401, 'filmCloud.unavailable'], [429, 'filmCloud.busy'], [503, 'filmCloud.busy'], [0, 'net.offline'], [500, 'common.error']])('list status %s shows only neutral copy', async (status, key) => {
    mockRequest.mockRejectedValue(new ApiError(status as number, 'unknown', { message: 'DATA_UNAVAILABLE not_found 404' })); await mount();
    expect(has(t(key as string))).toBe(true);
    for (const text of ['404', 'not_found', 'DATA_UNAVAILABLE', 'api_unknown']) expect(has(text)).toBe(false);
    if (status === 429 || status === 503) {
        mockRequest.mockResolvedValue({ projects: [row] }); await press(t('filmCloud.retry')); expect(has(row.name)).toBe(true);
    }
});
test.each([{ stack: ['/film'] }, { stack: [] as string[] }])('open without a local film dismisses to Film Studio from stack %p', async ({ stack }) => {
    const routes = [...stack];
    mockDismiss.mockImplementation(path => { const at = routes.indexOf(path); if (at >= 0) routes.splice(at + 1); else routes.push(path); });
    await mount(); await press();
    expect(RN.Alert.alert).not.toHaveBeenCalled(); expect(mockDismiss).toHaveBeenCalledWith('/film'); expect(mockReplace).not.toHaveBeenCalled();
    expect(routes.at(-1)).toBe('/film'); expect(getOpenedFilm()?.raw).toBe(detail.studio_json); expect(await loadStudio()).toBeNull();
});
test('replacement Cancel preserves the film; Replace opens the new one', async () => {
    await saveStudio(raw('Film A')); await mount(); await press();
    expect(RN.Alert.alert).toHaveBeenCalledWith(t('filmCloud.replaceTitle', { name: row.name }), t('filmCloud.replaceBody'), expect.any(Array), expect.any(Object));
    let actions = jest.mocked(RN.Alert.alert).mock.calls.at(-1)![2]!;
    await act(async () => { actions[0].onPress!(); });
    expect(getOpenedFilm()).toBeNull(); expect((await loadStudio())?.film.name).toBe('Film A'); expect(mockDismiss).not.toHaveBeenCalled();
    await press(); actions = jest.mocked(RN.Alert.alert).mock.calls.at(-1)![2]!;
    expect(actions[1].style).toBe('destructive');
    await act(async () => { actions[1].onPress!(); });
    expect(getOpenedFilm()?.film.name).toBe('Film B'); expect(mockDismiss).toHaveBeenCalledWith('/film');
});
test('a gone film announces the failure and refreshes the list', async () => {
    await mount(); mockRequest.mockImplementation(async path => { if (path.endsWith(id)) throw new ApiError(404, 'unknown'); return { projects: [] }; });
    await press(); expect(has(t('filmCloud.gone'))).toBe(true); expect(has(t('filmCloud.empty'))).toBe(true);
    expect(RN.AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(t('filmCloud.gone'));
    expect(root.container.queryAll(n => n.props.accessibilityLiveRegion === 'polite').length).toBeGreaterThan(0);
    expect(mockRequest).toHaveBeenCalledTimes(3);
});
test.each([[0, 'net.offline'], [403, 'filmCloud.unavailable'], [429, 'filmCloud.busy'], [500, 'common.error']])('open status %s announces neutral failure', async (status, key) => {
    await mount(); mockRequest.mockRejectedValue(new ApiError(status as number, 'unknown')); await press();
    expect(has(t(key as string))).toBe(true); expect(RN.AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(t(key as string)); expect(mockDismiss).not.toHaveBeenCalled();
});
test('invalid film cannot navigate', async () => {
    await mount(); mockRequest.mockResolvedValue({ ...detail, studio_json: '{}' }); await press();
    expect(has(t('filmCloud.invalid'))).toBe(true); expect(mockDismiss).not.toHaveBeenCalled();
});
test.each(['bob', 'alice'])('switch during opening drops rows and suppresses old result (%s)', async user => {
    await mount(); const pending = deferred<unknown>(); mockRequest.mockReturnValueOnce(pending.promise); await press();
    expect(buttons().every(n => n.props.accessibilityState.disabled)).toBe(true);
    expect(buttons()[0].props.accessibilityState.busy).toBe(true);
    // A second delivered tap is also guarded synchronously.
    await press(); expect(mockRequest).toHaveBeenCalledTimes(2);
    mockRequest.mockResolvedValue({ projects: [] });
    await act(async () => { await wipeCache(); await bindCacheUser(user); });
    expect(has(row.name)).toBe(false); expect(getOpenedFilm()).toBeNull();
    expect(await loadStudio()).toBeNull();
    await act(async () => { pending.resolve(detail); });
    expect(mockDismiss).not.toHaveBeenCalled(); expect(RN.AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled(); expect(getOpenedFilm()).toBeNull();
});
test('same-user reset permits a newer open while the old response is ignored', async () => {
    await mount(); const pending = deferred<unknown>(); mockRequest.mockReturnValueOnce(pending.promise); await press();
    await act(async () => { await wipeCache(); await bindCacheUser('alice'); });
    await press(); expect(getOpenedFilm()?.film.name).toBe('Film B'); expect(mockDismiss).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ ...detail, studio_json: raw('Old') }); });
    expect(getOpenedFilm()?.film.name).toBe('Film B'); expect(mockDismiss).toHaveBeenCalledTimes(1); expect(RN.AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
});
test('stale confirmation cannot start an open for a different session', async () => {
    await openCloudFilm({ request: jest.fn().mockResolvedValue(detail) }, id); await mount(); await press();
    const replace = jest.mocked(RN.Alert.alert).mock.calls[0][2]![1];
    await act(async () => bindCacheUser('bob')); const calls = mockRequest.mock.calls.length;
    await act(async () => replace.onPress!()); expect(mockRequest).toHaveBeenCalledTimes(calls); expect(mockDismiss).not.toHaveBeenCalled();
});
