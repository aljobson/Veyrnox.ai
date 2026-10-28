import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Calendar from '../src/app/(app)/publish/calendar';
import { fetchCalendar, type CalendarStatus } from '../src/lib/publishCalendar';
import { postStatusLabel } from '../src/lib/publish';
import { brandStore } from '../src/lib/publishBrand';
import { t } from '../src/lib/i18n';
import type { ApiClient } from '../src/lib/api';
import { deferred, press, textOf, OTHER } from './publishDepthTestHelpers';
jest.mock('../src/components/UnlockCard', () => ({ UnlockCard: () => null }));
const mockRequest = jest.fn(), mockApi = { request: mockRequest } as unknown as ApiClient;
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
void [RN.Pressable, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.RefreshControl];
let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(null); jest.clearAllMocks(); root = createRoot(); mockRequest.mockResolvedValue({ posts: [] }); });
afterEach(async () => { await act(async () => root.unmount()); brandStore.set(null); });
test('filters are allowlisted and encoded while existing call shape stays identical', async () => {
    const from = new Date('2026-10-26T00:00:00Z'), to = new Date('2026-11-02T00:00:00Z');
    await fetchCalendar(mockApi, from, to);
    const original = mockRequest.mock.calls[0][0];
    expect(original).toBe('/api/v1/social/calendar?from=2026-10-26T00%3A00%3A00.000Z&to=2026-11-02T00%3A00%3A00.000Z');
    await fetchCalendar(mockApi, from, to, { at: 'a&b', id: 'c d' }, { status: 'failed', network: 'twitter' });
    expect(mockRequest.mock.calls[1][0]).toBe(original + '&after_at=a%26b&after_id=c%20d&status=failed&network=twitter');
    for (const network of ['pinterest', 'bad&x', 'TWITTER']) {
        await fetchCalendar(mockApi, from, to, undefined, { status: 'draft' as CalendarStatus, network });
        expect(mockRequest.mock.calls.at(-1)![0]).toBe(original);
    }
    await fetchCalendar(mockApi, from, to, undefined, { status: null, network: null }); expect(mockRequest.mock.calls.at(-1)![0]).toBe(original);
});
test('status and network chips refetch, announce selection, and show filtered empty copy', async () => {
    await act(async () => root.render(<Calendar />));
    await press(root, postStatusLabel('scheduled')); await press(root, 'X');
    expect(mockRequest.mock.calls.at(-1)![0]).toContain('&status=scheduled&network=twitter');
    expect(textOf(root.container)).toContain(t('publishParity.calendar.noneFiltered'));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'X')[0].props.accessibilityState.selected).toBe(true);
    const calls = mockRequest.mock.calls.length; await press(root, 'X'); expect(mockRequest).toHaveBeenCalledTimes(calls);
    expect(textOf(root.container)).toContain(t('publishParity.calendar.timezone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    await press(root, t('publishParity.calendar.allStatuses')); await press(root, t('publishParity.calendar.allNetworks'));
    expect(mockRequest.mock.calls.at(-1)![0]).not.toMatch(/&status=|&network=/);
});
const row = (id: string, status: string) => ({ id, status, scheduled_at: new Date().toISOString(), global_text: `${id} caption`, targets: [] });
test('Failed beats older Scheduled results and stale pagination stops before the next page', async () => {
    const scheduled = deferred<unknown>(), failed = deferred<unknown>();
    mockRequest.mockImplementation((path: string) => path.includes('status=scheduled') ? scheduled.promise : path.includes('status=failed') ? failed.promise : Promise.resolve({ posts: [] }));
    await act(async () => root.render(<Calendar />)); await press(root, postStatusLabel('scheduled')); await press(root, postStatusLabel('failed'));
    await act(async () => failed.resolve({ posts: [row('failed-only', 'failed')] }));
    await act(async () => scheduled.resolve({ posts: [row('old-scheduled', 'scheduled')], next: { at: 'next', id: 'next' } }));
    expect(textOf(root.container)).toContain('failed-only caption'); expect(textOf(root.container)).not.toContain('old-scheduled caption');
    expect(mockRequest.mock.calls.some(([path]) => path.includes('after_id='))).toBe(false);
});
test('brand switch mid-pagination drops old posts and never follows its cursor', async () => {
    const old = deferred<unknown>(); mockRequest.mockImplementation(() => brandStore.get() === OTHER ? Promise.resolve({ posts: [row('new-brand', 'scheduled')] }) : old.promise);
    await act(async () => root.render(<Calendar />)); await act(async () => brandStore.set(OTHER));
    await act(async () => old.resolve({ posts: [row('old-brand', 'scheduled')], next: { at: 'a', id: 'b' } }));
    expect(textOf(root.container)).toContain('new-brand caption'); expect(textOf(root.container)).not.toContain('old-brand caption');
    expect(mockRequest.mock.calls.some(([path]) => path.includes('after_id='))).toBe(false);
});
