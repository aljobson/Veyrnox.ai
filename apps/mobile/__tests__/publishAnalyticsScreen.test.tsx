import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Screen from '../src/app/(app)/publish/analytics';
import { ApiError } from '../src/lib/api';
import { colors } from '../src/theme';
import { clearExportFiles, exportDirectory } from '../src/lib/appCache';
import { rangeBounds } from '../src/lib/publishAnalytics';
import { portfolioCsvName } from '../src/lib/publishAnalyticsDepth';
const mockRequest = jest.fn();
let mockApi = { request: mockRequest };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => mockParams, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('../src/components/UnlockCard', () => ({ UnlockCard: ({ feature }: { feature: string }) => { const { Text } = require('react-native'); return <Text testID="unlock">{feature}</Text>; } }));
void [RN.ScrollView, RN.Text, RN.Pressable, RN.StyleSheet, RN.View];
const accounts = [{ id: 'a', network: 'instagram', display_name: 'Studio', status: 'active' }, { id: 'b', network: 'twitter', display_name: null, external_account_id: 'studio_x', status: 'active' },
    { id: 'c', network: 'tiktok', status: 'expired' }, { id: 'd', network: 'facebook', status: 'active' }];
const analytics = { analyticsDays: 365, sync: { last_ok_at: '2026-10-27' }, evolution: [{ date: '2026-10-27', metrics: { followers: 40 } }],
    posts: [{ id: 'p1', type: 'image', caption: '#Studio launch', permalink: 'https://example.com/post', metrics: { likes: 4, reach: 100 } }] };
let root: Root;
const requests = () => mockRequest.mock.calls.filter(([p]) => p.startsWith('/api/v1/social/analytics'));
function has(text: string) { return root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(text))).length > 0; }
function buttons(label: string) { return root.container.queryAll(n => n.props.accessibilityRole === 'button' && (n.props.accessibilityLabel === label || n.children.some(c => typeof c === 'object' && c !== null && 'children' in c && (c.children as unknown[]).includes(label)))); }
async function press(label: string) {
    const nodes = buttons(label); expect(nodes).toHaveLength(1);
    await act(async () => { nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
async function mount() { root = createRoot(); await act(async () => root.render(<Screen />)); }
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockParams = {}; mockApi = { request: mockRequest }; jest.clearAllMocks(); clearExportFiles();
    (Sharing.shareAsync as jest.Mock).mockResolvedValue(undefined);
    mockRequest.mockImplementation(async (path: string) => path === '/api/v1/social/accounts' ? { accounts } : analytics);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); clearExportFiles(); });
test('defaults to all supported active accounts, makes two requests and exports only loaded data', async () => {
    await mount(); expect(requests()).toHaveLength(2);
    expect(requests().map(([path]) => new URL(path, 'https://example.com').searchParams.get('accountId'))).toEqual(['a', 'b']);
    expect(buttons('All accounts')[0].props.accessibilityState.selected).toBe(true);
    const { from, to } = rangeBounds(30); const file = new File(exportDirectory(), portfolioCsvName(from, to));
    let exported = '';
    (Sharing.shareAsync as jest.Mock).mockImplementation(async () => { expect(file.exists).toBe(true); exported = await file.text(); });
    await press('Export CSV for All accounts');
    expect(Sharing.shareAsync).toHaveBeenCalledWith(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
    expect(exported).toContain('twitter,studio_x,40,1,4,100'); expect(file.exists).toBe(false); expect(requests()).toHaveLength(2);
});
test('any 402 including the previous period displays UnlockCard', async () => {
    mockParams = { compare: '1' };
    mockRequest.mockImplementation(async (path: string) => {
        if (path === '/api/v1/social/accounts') return { accounts };
        if (requests().length === 4) throw new ApiError(402, 'publish_plan_required');
        return analytics;
    });
    await mount(); expect(root.container.queryAll(n => n.props.testID === 'unlock')).toHaveLength(1);
    expect(buttons('Export CSV for All accounts')).toHaveLength(0);
});
test('saved params show title/accent, choose account and clamp period', async () => {
    mockParams = { account: 'a', days: '365', compare: '1', content: '0', reportTitle: 'Quarterly review', accent: '#AABBCC' };
    mockRequest.mockImplementation(async (path: string) => path === '/api/v1/social/accounts' ? { accounts } : { ...analytics, analyticsDays: 90 });
    await mount();
    expect(has('Quarterly review')).toBe(true);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.children.includes('Quarterly review'))).toHaveLength(1);
    expect(JSON.stringify(root.container.queryAll(n => n.props.style).map(n => n.props.style))).toContain('#aabbcc');
    expect(buttons('Studio')[0].props.accessibilityState.selected).toBe(true);
    expect(requests().every(([path]) => path.includes('accountId=a'))).toBe(true);
    expect(requests().some(([p]) => p.includes(`from=${rangeBounds(90).from}`))).toBe(true);
    expect(has('Content performance')).toBe(false);
});
test('invalid saved account falls back to portfolio, failures stay quiet and Retry reloads', async () => {
    mockParams = { account: 'gone' };
    mockRequest.mockImplementation(async (path: string) => path === '/api/v1/social/accounts' ? { accounts } : Promise.reject(new ApiError(503, 'private_code')));
    await mount(); expect(has('Could not load analytics.')).toBe(true); expect(has('private_code')).toBe(false);
    mockRequest.mockImplementation(async (path: string) => path === '/api/v1/social/accounts' ? { accounts } : analytics);
    await press('Retry'); expect(has('Audience')).toBe(true);
});
test('partial failures show a count and compare uses only accounts loaded in both periods', async () => {
    mockParams = { compare: '1' };
    mockRequest.mockImplementation(async (path: string) => {
        if (path === '/api/v1/social/accounts') return { accounts };
        if (path.includes('accountId=b')) throw new ApiError(503, 'unavailable');
        return analytics;
    });
    await mount(); expect(has('Accounts not loaded: 1')).toBe(true); expect(has('Accounts compared: 1')).toBe(true);
});
test('single account adds content tables and shares content CSV with cleanup on failure', async () => {
    mockParams = { account: 'a' }; await mount();
    expect(has('Content performance')).toBe(true); expect(has('Hashtag performance')).toBe(true);
    expect(has('#studio')).toBe(true);
    (Sharing.shareAsync as jest.Mock).mockRejectedValue(new Error('private'));
    await press('Export CSV for Studio');
    expect(new File(exportDirectory(), 'veyrnox-instagram-content.csv').exists).toBe(false);
    expect(has('Could not share the CSV. Try again.')).toBe(true); expect(has('private')).toBe(false);
});
test('unmount deletes a CSV while sharing is pending', async () => {
    await mount(); let resolveShare: () => void = () => {};
    (Sharing.shareAsync as jest.Mock).mockImplementation(() => new Promise<void>(resolve => { resolveShare = resolve; }));
    const node = buttons('Export CSV for All accounts')[0];
    await act(async () => { node.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
    const { from, to } = rangeBounds(30); const file = new File(exportDirectory(), portfolioCsvName(from, to));
    expect(file.exists).toBe(true); expect(buttons('Export CSV for All accounts')[0].props.accessibilityState.busy).toBe(true);
    await act(async () => root.unmount()); expect(file.exists).toBe(false);
    await act(async () => resolveShare());
});

test('switching brand never requests old account ids through the new API or shows old data', async () => {
    await mount(); expect(has('Studio')).toBe(true);
    const nextRequest = jest.fn().mockResolvedValue({ accounts: [] });
    mockApi = { request: nextRequest };
    await act(async () => root.render(<Screen />));
    expect(nextRequest.mock.calls).toEqual([['/api/v1/social/accounts']]);
    expect(has('Studio')).toBe(false); expect(buttons('Export CSV for All accounts')).toHaveLength(0);
});

test.each([
    [0, 'No connection. Check your internet and try again.', false],
    [404, 'That account is no longer available.', false],
    [429, 'Too many requests. Try again in a moment.', false],
    [0, 'No connection. Check your internet and try again.', true],
    [404, 'That account is no longer available.', true],
    [429, 'Too many requests. Try again in a moment.', true],
] as const)('single-account failure %s is announced: %s (explicit selection: %s)', async (status, message, selected) => {
    mockParams = selected ? { account: 'a', compare: '1' } : {};
    mockRequest.mockImplementation(async (path: string) => {
        if (path === '/api/v1/social/accounts') return { accounts: selected ? accounts : [accounts[0]] };
        throw new ApiError(path.includes(`from=${rangeBounds(30).from}`) ? status : 503, 'private_error_code');
    });
    await mount();
    const alerts = root.container.queryAll(n => n.props.accessibilityRole === 'alert' && n.children.includes(message));
    expect(alerts).toHaveLength(1);
    expect(RN.StyleSheet.flatten(alerts[0].props.style).color).toBe(colors.danger);
    expect(has('Could not load analytics.')).toBe(false); expect(has('private_error_code')).toBe(false);
    expect(buttons('Retry')).toHaveLength(1);
});
test('only section titles are headings, not account, format or hashtag rows', async () => {
    await mount();
    const headings = () => root.container.queryAll(n => n.props.accessibilityRole === 'header').flatMap(n => n.children.filter(c => typeof c === 'string'));
    expect(headings()).toContain('All accounts'); expect(headings()).not.toContain('Studio'); expect(headings()).not.toContain('twitter');
    await press('Studio');
    expect(headings()).toEqual(expect.arrayContaining(['Content performance', 'Top content', 'Hashtag performance']));
    expect(headings()).not.toContain('Image'); expect(headings()).not.toContain('#studio');
});
