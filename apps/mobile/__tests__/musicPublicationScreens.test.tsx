import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { MusicPublication } from '../src/components/music/MusicPublication';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser } from '../src/lib/appCache';
import { t } from '../src/lib/i18n';
import { detail, input, publication, receipt, deferred } from './fixtures/musicPublication';
const mockApi = { request: jest.fn() };
let mockGeneration = 0;
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, generation: mockGeneration }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => jest.requireActual('node:crypto').randomUUID() }));
void [RN.View, RN.ScrollView, RN.Text, RN.Pressable, RN.Modal];
let root: Root;
const texts = (s: string) => root.container.queryAll(n => n.children.includes(s));
const buttons = (key: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t(key));
const click = async (key: string) => { await act(async () => buttons(key)[0].props.onClick({ nativeEvent: {} })); };
const field = (key: string) => root.container.queryAll(n => n.props.accessibilityLabel === t(key) && typeof n.props.onChangeText === 'function')[0];
const edit = async (key: string, text: string) => { await act(async () => field(key).props.onChangeText(text)); };
const check = async (index: number) => { await act(async () => root.container.queryAll(n => n.props.accessibilityRole === 'checkbox')[index].props.onClick({ nativeEvent: {} })); };
const writes = (method = 'POST') => mockApi.request.mock.calls.filter(([, init]) => init?.method === method);
const mount = async () => { await act(async () => root.render(<MusicPublication song={detail} />)); };
async function open() { await mount(); await click('musicPublication.publish'); await edit('musicPublication.handle', input.handle); await edit('musicPublication.name', input.display_name); }
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; resetCacheUser(); await bindCacheUser('p4c-user');
    jest.clearAllMocks(); mockGeneration = 0; root = createRoot(); mockApi.request.mockResolvedValue({ publication: null });
});
afterEach(async () => { await act(async () => { root.unmount(); resetCacheUser(); }); jest.restoreAllMocks(); });
test('rights unchecked blocks submit; permissions and rights review are visible', async () => {
    await open(); expect(buttons('musicPublication.confirm')[0].props.accessibilityState.disabled).toBe(true);
    expect(texts(t('musicPublication.rights')).length).toBeGreaterThan(0); expect(texts(t('musicPublication.permissions')).length).toBeGreaterThan(0);
    expect(writes()).toHaveLength(0); await check(2);
    expect(buttons('musicPublication.confirm')[0].props.accessibilityState.disabled).toBe(false);
    await check(0); await check(1); mockApi.request.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ publication });
    await click('musicPublication.confirm');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ ...input, allow_comments: false, allow_remixes: true, idempotency_key: expect.any(String) });
    expect(mockApi.request.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['GET', 'POST', 'GET']);
});
test.each([['musicPublication.handle', 'ABc', 'musicPublication.handleInvalid'], ['musicPublication.handle', 'ab', 'musicPublication.handleInvalid'],
    ['musicPublication.name', 'x'.repeat(81), 'musicPublication.nameInvalid'], ['musicPublication.name', 'A\nB', 'musicPublication.nameInvalid']])('inline validation for %s %j', async (key, value, error) => {
    await open(); await check(2); await edit(key, value);
    expect(buttons('musicPublication.confirm')[0].props.accessibilityState.disabled).toBe(true);
    expect(texts(t(error)).length).toBeGreaterThan(0); expect(writes()).toHaveLength(0);
});
test.each([[400, 'publication_not_allowed', 'musicPublication.policy'], [409, 'handle_taken', 'musicPublication.handleTaken']] as const)('dialog displays %s %s and unlocks a new attempt', async (status, code, key) => {
    await open(); await check(2); mockApi.request.mockRejectedValueOnce(new ApiError(status, code, code === 'publication_not_allowed' ? { policy_version: 'music-publication-v1' } : {})).mockResolvedValueOnce({ publication: null });
    await click('musicPublication.confirm'); expect(texts(t(key)).length).toBeGreaterThan(0);
    expect(field('musicPublication.handle').props.editable).toBe(true); expect(buttons('musicPublication.retry')).toHaveLength(0);
    mockApi.request.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ publication: null }); await click('musicPublication.confirm');
    expect(JSON.parse(writes()[0][1].body).idempotency_key).not.toBe(JSON.parse(writes()[1][1].body).idempotency_key);
});
test('dialog replays exactly the same publish payload after unknown outcome', async () => {
    await open(); await check(2); mockApi.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ publication: null });
    await click('musicPublication.confirm'); expect(field('musicPublication.handle').props.editable).toBe(false);
    mockApi.request.mockResolvedValueOnce(receipt).mockResolvedValueOnce({ publication }); await click('musicPublication.retry');
    expect(writes()[0]).toEqual(writes()[1]); expect(texts(t('musicPublication.published')).length).toBeGreaterThan(0);
});
test('unpublish waits for confirmation, refetches an intervening republish, and requires new confirmation/key', async () => {
    const alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    mockApi.request.mockResolvedValueOnce({ publication }); await mount(); await click('musicPublication.unpublish');
    expect(writes('DELETE')).toHaveLength(0); expect(alert.mock.calls[0][2]?.[0].style).toBe('cancel');
    const confirm = alert.mock.calls[0][2]![1].onPress!;
    const newer = { ...publication, slug: 'b'.repeat(24) };
    mockApi.request.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ publication: newer });
    await act(async () => { confirm(); }); expect(writes('DELETE')).toHaveLength(1);
    expect(texts(t('musicPublication.checkUnpublish')).length).toBeGreaterThan(0); expect(buttons('musicPublication.retry')).toHaveLength(0);
    await act(async () => { confirm(); }); expect(writes('DELETE')).toHaveLength(1);
    await click('musicPublication.unpublish'); expect(writes('DELETE')).toHaveLength(1);
    mockApi.request.mockResolvedValueOnce({ ok: true, idempotent: false }).mockResolvedValueOnce({ publication: null });
    await act(async () => { alert.mock.calls[1][2]![1].onPress!(); });
    expect(writes('DELETE')).toHaveLength(2); expect(writes('DELETE')[0][1].body).not.toBe(writes('DELETE')[1][1].body);
    expect(texts(t('musicPublication.private')).length).toBeGreaterThan(0);
});
test.each(['music_publication_unavailable', 'music_unavailable'])('%s hides publication section', async code => {
    mockApi.request.mockRejectedValue(new ApiError(404, code)); await mount(); expect(root.container.children).toHaveLength(0);
});
test('moderation removal shows a notice without publish, unpublish or a dialog', async () => {
    mockApi.request.mockResolvedValue({ publication: { ...publication, status: 'blocked' } });
    await mount();
    expect(texts(t('musicPublication.removedByModeration'))).toHaveLength(1);
    for (const key of ['publish', 'unpublish', 'confirm', 'retry']) expect(buttons(`musicPublication.${key}`)).toHaveLength(0);
    expect(texts(t('musicPublication.private'))).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.presentationStyle === 'pageSheet')).toHaveLength(0);
    expect(writes()).toHaveLength(0); expect(writes('DELETE')).toHaveLength(0);
});
test('a moderation removal returned after a write hides the open dialog and pending retry', async () => {
    await open(); await check(2);
    mockApi.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ publication: { ...publication, status: 'blocked' } });
    await click('musicPublication.confirm');
    expect(texts(t('musicPublication.removedByModeration'))).toHaveLength(1);
    for (const key of ['publish', 'unpublish', 'confirm', 'retry']) expect(buttons(`musicPublication.${key}`)).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.presentationStyle === 'pageSheet')).toHaveLength(0);
});
test('account generation and unmount discard late publication results', async () => {
    const late = deferred<unknown>(); mockApi.request.mockReturnValueOnce(late.promise); await mount();
    mockGeneration++; await mount(); await act(async () => late.resolve({ publication }));
    expect(buttons('musicPublication.unpublish')).toHaveLength(0);
    const pending = deferred<unknown>(); mockApi.request.mockReturnValueOnce(pending.promise); mockGeneration++; await mount();
    await act(async () => root.unmount()); const calls = mockApi.request.mock.calls.length;
    await act(async () => pending.resolve({ publication })); expect(mockApi.request).toHaveBeenCalledTimes(calls);
});
