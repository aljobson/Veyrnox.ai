import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Reports from '../src/app/(app)/publish/reports';
import Editor from '../src/app/(app)/publish/report-edit';
import { ApiError } from '../src/lib/api';
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
const mockRouter = { push: jest.fn(), back: jest.fn() };
let mockParams: { id?: string } = {};
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter, useLocalSearchParams: () => mockParams,
    useFocusEffect: (callback: () => void) => { const { useEffect } = require('react'); useEffect(callback, [callback]); } }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
void [RN.ScrollView, RN.FlatList, RN.Text, RN.TextInput, RN.Pressable, RN.StyleSheet, RN.View, RN.Switch];
const id = '11111111-1111-4111-8111-111111111111';
const seed = { id, name: 'Weekly report', account_id: null, range_days: 30, compare_previous: true, include_content: true,
    report_title: 'Studio results', accent_color: '#38bdf8', delivery_cadence: 'weekly', delivery_hour_utc: 9, delivery_weekday: 1,
    delivery_day: null, delivery_recipients: ['reader@example.com'], delivery_reply_to: 'reply@example.com', delivery_message: 'Saved message', delivery_format: 'pptx' };
let templates: Record<string, unknown>[];
let flags: { scheduledReportsEnabled: boolean; reportDeliveryEnabled: boolean };
let role: string;
let root: Root;
let alert: jest.SpyInstance;
function has(text: string) { return root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(text))).length > 0; }
function buttons(label: string) { return root.container.queryAll(n => n.props.accessibilityRole === 'button' && (n.props.accessibilityLabel === label || n.children.some(c => typeof c === 'object' && c !== null && 'children' in c && (c.children as unknown[]).includes(label)))); }
async function press(label: string) {
    const nodes = buttons(label); expect(nodes).toHaveLength(1);
    await act(async () => { nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
function input(label: string) { return root.container.queryAll(n => n.props.accessibilityLabel === label && n.props.onChangeText)[0]; }
async function type(label: string, text: string) { expect(input(label)).toBeDefined(); await act(async () => input(label).props.onChangeText(text)); }
const writes = () => mockRequest.mock.calls.filter(([, init]) => init?.method === 'PUT' || init?.method === 'DELETE');
const body = () => JSON.parse(writes().at(-1)?.[1].body);
async function confirm() { const choices = alert.mock.calls.at(-1)?.[2]; expect(choices).toBeDefined(); await act(async () => choices[1].onPress()); }
async function cancel() { const choices = alert.mock.calls.at(-1)?.[2]; expect(choices).toBeDefined(); await act(async () => choices[0].onPress()); }
async function mount(editor = false) { root = createRoot(); await act(async () => root.render(editor ? <Editor /> : <Reports />)); }
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); mockParams = {}; role = 'analyst'; templates = [{ ...seed }];
    flags = { scheduledReportsEnabled: true, reportDeliveryEnabled: true };
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    mockRequest.mockImplementation(async (path: string, init?: { method: string }) => {
        if (init?.method === 'PUT') return { template_id: id };
        if (init?.method === 'DELETE') { templates = []; return { ok: true }; }
        if (path === '/api/v1/social/accounts') return { accounts: [{ id, network: 'twitter', display_name: 'Studio', status: 'active' }] };
        return { templates, brandRole: role, reportExportsEnabled: true, ...flags };
    });
});
afterEach(async () => { if (root) await act(async () => root.unmount()); alert.mockRestore(); });
test('analyst sees New/Edit/Delete and Open pushes validated report parameters', async () => {
    await mount(); expect(buttons('New report')).toHaveLength(1); expect(buttons('Edit Weekly report')).toHaveLength(1); expect(buttons('Delete Weekly report')).toHaveLength(1);
    await press('Open Weekly report'); expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/publish/analytics', params: { days: '30', compare: '1', account: '', content: '1', reportTitle: 'Studio results', accent: '#38bdf8' } });
    await press('New report'); expect(mockRouter.push).toHaveBeenLastCalledWith('/publish/report-edit');
});
test('viewer gets Open and a role note, but no editing controls', async () => {
    role = 'viewer'; await mount(); expect(buttons('New report')).toHaveLength(0); expect(buttons('Edit Weekly report')).toHaveLength(0); expect(buttons('Delete Weekly report')).toHaveLength(0);
    expect(buttons('Open Weekly report')).toHaveLength(1); expect(has('Your role can view reports.')).toBe(true);
});
test('delete names the report, is destructive and only confirm sends DELETE, then reloads', async () => {
    await mount(); await press('Delete Weekly report'); expect(writes()).toHaveLength(0);
    expect(alert.mock.calls[0][1]).toContain('Weekly report'); expect(alert.mock.calls[0][2][1].style).toBe('destructive');
    await cancel(); expect(writes()).toHaveLength(0);
    await press('Delete Weekly report'); await confirm();
    expect(writes()).toEqual([[`/api/v1/social/reports?id=${id}`, { method: 'DELETE' }]]);
    expect(has('Report deleted.')).toBe(true); expect(buttons('Open Weekly report')).toHaveLength(0);
});
test.each([1, 2])('full schedule editing confirms email delivery for %i recipients and cancellation sends nothing', async count => {
    const recipients = ['reader@example.com', 'second@example.com'].slice(0, count);
    templates = [{ ...seed, delivery_recipients: recipients }];
    mockParams = { id }; await mount(true); await press('Save'); expect(writes()).toHaveLength(0);
    expect(alert.mock.calls.at(-1)?.[1]).toBe(`This report will be emailed every week as PowerPoint. Recipients: ${count}.`);
    await cancel(); expect(writes()).toHaveLength(0); await press('Save'); await confirm();
    expect(body()).toMatchObject({ deliveryCadence: 'weekly', deliveryRecipients: recipients, deliveryFormat: 'pptx' }); expect(mockRouter.back).toHaveBeenCalledTimes(1);
});
test('scheduling off makes a weekly report read-only; conversion confirms and keeps saved delivery fields', async () => {
    mockParams = { id }; flags.scheduledReportsEnabled = false; await mount(true);
    expect(input('Report name').props.editable).toBe(false); expect(input('Recipients').props.editable).toBe(false); expect(buttons('Save')).toHaveLength(0);
    await press('Turn off schedule and save'); expect(writes()).toHaveLength(0);
    expect(alert.mock.calls.at(-1)?.[1]).toBe('This report will no longer be sent automatically. It becomes manual.');
    await cancel(); expect(writes()).toHaveLength(0); await press('Turn off schedule and save'); await confirm();
    expect(body()).toMatchObject({ name: seed.name, reportTitle: seed.report_title, deliveryCadence: 'manual', deliveryHourUtc: null, deliveryWeekday: null,
        deliveryRecipients: seed.delivery_recipients, deliveryReplyTo: seed.delivery_reply_to, deliveryMessage: seed.delivery_message, deliveryFormat: seed.delivery_format });
});
test.each([1, 2])('delivery off with %i recipients allows timing edits and preserves delivery with an accurate confirmation', async count => {
    const recipients = ['reader@example.com', 'second@example.com'].slice(0, count);
    templates = [{ ...seed, delivery_recipients: recipients }];
    mockParams = { id }; flags.reportDeliveryEnabled = false; await mount(true);
    expect(input('Report name').props.editable).toBe(true); expect(input('Recipients').props.editable).toBe(false); expect(input('Reply-to email').props.editable).toBe(false);
    await press('10:00'); await press('Save');
    expect(writes()).toHaveLength(0); expect(alert.mock.calls.at(-1)?.[1]).toBe(`The schedule is saved as PowerPoint. Recipients: ${count}. Automatic email delivery is not switched on yet, so nothing will be sent until it is.`);
    expect(alert.mock.calls.at(-1)?.[1]).not.toContain('will be emailed');
    await confirm(); expect(body()).toMatchObject({ deliveryHourUtc: 10, deliveryRecipients: recipients, deliveryReplyTo: seed.delivery_reply_to, deliveryMessage: seed.delivery_message, deliveryFormat: seed.delivery_format });
});
test('delivery off with a legacy recipient-free schedule only allows confirmed conversion', async () => {
    mockParams = { id }; flags.reportDeliveryEnabled = false; templates = [{ ...seed, delivery_recipients: [] }]; await mount(true);
    expect(input('Report name').props.editable).toBe(false); expect(buttons('Save')).toHaveLength(0);
    expect(has('This schedule has no recipients')).toBe(true);
    await press('Turn off schedule and save'); expect(writes()).toHaveLength(0); await confirm();
    expect(body()).toMatchObject({ deliveryCadence: 'manual', deliveryRecipients: [] });
});
test('both flags on lets a legacy schedule be repaired but cannot save until a recipient is valid', async () => {
    mockParams = { id }; templates = [{ ...seed, delivery_recipients: [] }]; await mount(true);
    expect(input('Recipients').props.editable).toBe(true); await press('Save');
    expect(alert).not.toHaveBeenCalled(); expect(writes()).toHaveLength(0); expect(has('Check the fields')).toBe(true);
    await type('Recipients', ' READER@example.com; reader@example.com '); await press('Save');
    expect(alert.mock.calls.at(-1)?.[1]).toContain('will be emailed'); await confirm(); expect(body().deliveryRecipients).toEqual(['reader@example.com']);
});
test.each([[true, true], [true, false], [false, true], [false, false]])('manual templates remain editable with scheduling=%s delivery=%s', async (scheduledReportsEnabled, reportDeliveryEnabled) => {
    mockParams = { id }; flags = { scheduledReportsEnabled, reportDeliveryEnabled }; templates = [{ ...seed, delivery_cadence: 'manual', delivery_recipients: [] }]; await mount(true);
    expect(input('Report name').props.editable).toBe(true); await type('Report name', 'Renamed'); await press('Save');
    expect(alert).not.toHaveBeenCalled(); expect(body()).toMatchObject({ name: 'Renamed', deliveryCadence: 'manual' });
    if (!scheduledReportsEnabled || !reportDeliveryEnabled) expect(buttons('Weekly')).toHaveLength(0);
});
test('unknown id and viewer cannot save; bad accent blocks creation', async () => {
    mockParams = { id: 'missing' }; await mount(true); expect(has('This report is no longer available.')).toBe(true); expect(buttons('Save')).toHaveLength(0);
    await act(async () => root.unmount()); mockParams = {}; await mount(true);
    await type('Report name', 'New one'); await type('Accent colour (hex)', 'red'); await press('Save');
    expect(writes()).toHaveLength(0); expect(has('Enter a hex colour')).toBe(true);
    await type('Accent colour (hex)', '#123456'); await press('Save'); expect(body()).toMatchObject({ id: null, name: 'New one', accentColor: '#123456' });
});
test('viewer opening edit directly sees disabled fields and no save', async () => {
    mockParams = { id }; role = 'viewer'; await mount(true); expect(input('Report name').props.editable).toBe(false); expect(buttons('Save')).toHaveLength(0);
});

test.each([null, id])('accounts failure keeps the editor usable and preserves saved account %s', async accountId => {
    mockParams = { id }; templates = [{ ...seed, account_id: accountId, delivery_cadence: 'manual' }];
    const request = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((path: string, init?: { method: string }) => path === '/api/v1/social/accounts'
        ? Promise.reject(new ApiError(429, 'rate_limited')) : request(path, init));
    await mount(true);
    expect(input('Report name').props.editable).toBe(true);
    expect(buttons('All accounts')).toHaveLength(1); expect(buttons('Studio')).toHaveLength(0);
    expect(has('The saved account is not active.')).toBe(accountId !== null);
    await type('Report name', 'Renamed after account failure'); await press('Save');
    expect(body()).toMatchObject({ name: 'Renamed after account failure', accountId, deliveryCadence: 'manual' });
});
