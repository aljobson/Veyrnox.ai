import { act, createElement } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { ApiError, type ApiClient } from '../src/lib/api';
import { BLUESKY_APP_PASSWORD_RE, BLUESKY_HANDLE_RE, PHONE_CATALOGUE, RETURN_URL, blueskyErrorKey, connectErrorKey, fetchConnectNetworks, finishSelection, parseConnectNetworks, runConnect } from '../src/lib/publishConnect';
import { BlueskyConnectForm } from '../src/components/publish/BlueskyConnectForm';
import Connect from '../src/app/(app)/publish/connect';
import { t } from '../src/lib/i18n';
import { ID, deferred, field, input, press, textOf } from './publishDepthTestHelpers';
declare const __dirname: string;
const fs = require('fs'), path = require('path');
const mockRequest = jest.fn(), mockApi = { request: mockRequest } as unknown as ApiClient;
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock('../src/lib/auth/pkce', () => ({ createPkce: async () => ({ challenge: 'challenge', verifier: 'verifier' }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('server list filters readiness and Pinterest, uses fixed labels and catalogue order', async () => {
    const networks = [...PHONE_CATALOGUE].reverse().map(key => ({ key, available: true, status: 'available', label: 'untrusted' }));
    expect(parseConnectNetworks({ networks })?.map(r => r.key)).toEqual(PHONE_CATALOGUE);
    expect(parseConnectNetworks({ networks })?.find(r => r.key === 'twitter')?.label).toBe('X (Twitter)');
    expect(parseConnectNetworks({ networks: [...networks.slice(0, 1), { key: 'pinterest', available: true, status: 'available' }, { key: 'youtube', available: false, status: 'setup_required' }, { key: 'linkedin', available: true, status: 'testing_disabled' }, { key: 'twitter', status: 'not_released' }, { key: 'instagram', available: false, status: 'available' }] })).toEqual([
        { key: 'youtube', label: 'YouTube', state: 'setup' }, { key: 'gmb', label: 'Google Business Profile', state: 'available' },
    ]);
    for (const body of [null, {}, { networks: {} }]) expect(parseConnectNetworks(body)).toBeNull();
    expect(parseConnectNetworks({ networks: [] })).toEqual([]);
    mockRequest.mockResolvedValue({ networks }); await fetchConnectNetworks(mockApi);
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/social/accounts');
});
async function connectChoice(body: unknown) {
    mockRequest.mockResolvedValueOnce({ authorizeUrl: 'https://provider.example/?state=s' }).mockResolvedValueOnce(body);
    return runConnect(mockApi, 'facebook', { open: async () => ({ type: 'success', url: `${RETURN_URL}?network=facebook&state=s&code=c` }) });
}
test('chooser bounds plain labels and drops invalid choices; selection posts mobile body', async () => {
    expect(await connectChoice({ ok: false, selectionId: ID, choices: [{ id: 'page', label: '\u0000' + 'x'.repeat(140) }, { id: 9, label: 'bad' }] })).toEqual({ kind: 'choose', network: 'facebook', selectionId: ID, choices: [{ id: 'page', label: 'x'.repeat(120) }] });
    mockRequest.mockResolvedValue({ ok: true, account: { id: ID } });
    expect((await finishSelection(mockApi, 'gmb', ID, 'location')).kind).toBe('connected');
    expect(mockRequest).toHaveBeenLastCalledWith('/api/v1/social/accounts/gmb/callback', expect.objectContaining({ method: 'POST', body: JSON.stringify({ selectionId: ID, resourceId: 'location', client: 'mobile' }) }));
});
test.each([
    { ok: false, selectionId: 'bad', choices: [{ id: 'x', label: 'x' }] },
    { ok: false, selectionId: ID, choices: [] },
    { ok: false, selectionId: ID, choices: [{ id: 'x'.repeat(129), label: 'x' }] },
    { ok: false, selectionId: ID, choices: Array(201).fill({ id: 'x', label: 'x' }) },
])('malformed chooser is an error', async body => { expect(await connectChoice(body)).toEqual({ kind: 'error', key: 'common.error' }); });
test.each([
    ['NO_ELIGIBLE_RESOURCE', 'publishDepth.connect.noResource'], ['selection_expired', 'connect.err.state'], ['invalid_selection', 'connect.err.failed'], ['too_many_resources', 'connect.err.failed'],
])('maps %s', (code, key) => { expect(connectErrorKey(new ApiError(409, code, { code }))).toBe(key); });
test.each([
    [409, { code: 'ACCOUNT_LIMIT' }, 'connect.err.limit'], [502, { stage: 'record_account' }, 'publishDepth.bluesky.saveFailed'],
    [502, { stage: 'provider_session', code: 'unexpected_failure' }, 'publishDepth.bluesky.sessionFailed'],
    [502, { stage: 'provider_session', code: 'provider_request_failed_400' }, 'publishDepth.bluesky.failed'],
    [502, { stage: 'provider_session', code: 'provider_request_failed_401' }, 'publishDepth.bluesky.failed'],
    [400, {}, 'publishDepth.bluesky.failed'], [429, {}, 'connect.err.rate'], [0, {}, 'connect.err.network'], [404, {}, 'connect.err.unavailable'], [503, {}, 'connect.err.later'],
])('Bluesky error %s %j', (status, body, key) => { expect(blueskyErrorKey(new ApiError(status as number, 'connect_failed', body as Record<string, unknown>))).toBe(key); });
test('regex contract and server drift', () => {
    expect(BLUESKY_HANDLE_RE.test('user.bsky.social')).toBe(true); expect(BLUESKY_HANDLE_RE.test('@user')).toBe(false);
    expect(BLUESKY_APP_PASSWORD_RE.test('abcd-abcd-abcd-abcd')).toBe(true); expect(BLUESKY_APP_PASSWORD_RE.test('ABCD-1234-efgh-5678')).toBe(false);
    const server = (file: string) => fs.readFileSync(path.join(__dirname, '../../..', file), 'utf8');
    const networks = server('lib/social/networks.js').split('export const SOCIAL_CATALOGUE')[0];
    expect([...networks.matchAll(/key: '([^']+)'/g)].map(m => m[1]).filter(key => key !== 'pinterest')).toEqual(PHONE_CATALOGUE);
    expect(server('lib/social/networks.js')).toContain("SOCIAL_NETWORKS.filter((network) => network.key !== 'pinterest')");
    expect(server('app/social/connect/mobile/[network]/route.js')).toMatch(/!n.credentials/);
    const extended = server('lib/social/extendedConnect.js');
    expect(extended).toContain("['facebook', 'pinterest', 'gmb']"); expect(extended).toContain(BLUESKY_HANDLE_RE.source); expect(extended).toContain(BLUESKY_APP_PASSWORD_RE.source);
});
test('password is cleared before request resolves; bad input sends nothing', async () => {
    const pending = deferred<unknown>(); mockRequest.mockReturnValue(pending.promise);
    await act(async () => root.render(createElement(BlueskyConnectForm, { api: mockApi, onCancel: jest.fn() })));
    await press(root, t('connect.button')); expect(mockRequest).not.toHaveBeenCalled(); expect(textOf(root.container)).toContain(t('publishDepth.bluesky.badHandle'));
    await input(root, t('publishDepth.bluesky.handle'), 'user.bsky.social'); await input(root, t('publishDepth.bluesky.password'), 'bad');
    await press(root, t('connect.button')); expect(mockRequest).not.toHaveBeenCalled();
    await input(root, t('publishDepth.bluesky.password'), 'abcd-abcd-abcd-abcd'); await press(root, t('connect.button'));
    expect(field(root, t('publishDepth.bluesky.password')).props.value).toBe('');
    expect(JSON.parse(mockRequest.mock.calls[0][1].body)).toEqual({ identifier: 'user.bsky.social', appPassword: 'abcd-abcd-abcd-abcd', client: 'mobile' });
    await act(async () => pending.resolve({ ok: true, account: { id: ID } }));
    expect(textOf(root.container)).toContain(t('connect.done', { name: 'Bluesky' }));
});
test('screen load failure falls back to exactly the original four', async () => {
    mockRequest.mockRejectedValue(new ApiError(0, 'network'));
    await act(async () => root.render(createElement(Connect)));
    const buttons = root.container.queryAll(n => n.props.accessibilityRole === 'button');
    expect(buttons.map(n => n.props.accessibilityLabel)).toEqual(['YouTube', 'LinkedIn', 'X (Twitter)', 'TikTok'].map(network => t('connect.action', { network })));
});
