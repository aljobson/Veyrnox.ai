import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import Compose from '../src/app/(app)/publish/compose';
import ApprovalNew from '../src/app/(app)/publish/approval-new';
import type { PublishUploadPanel } from '../src/components/PublishUploadPanel';
import { t } from '../src/lib/i18n';

let mockPanel: React.ComponentProps<typeof PublishUploadPanel>;
const mockRequest = jest.fn();
const mockApi = { request: mockRequest };
const mockJob = { job_id: 'j', model_id: 'image', state: 'succeeded', has_asset: true, created_at: '2026-10-21', label: 'Creation A' };
jest.mock('../src/components/PublishUploadPanel', () => ({ PublishUploadPanel: (props: React.ComponentProps<typeof PublishUploadPanel>) => { mockPanel = props; return null; } }));
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ replace: jest.fn() }), useLocalSearchParams: () => ({}) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', appStorage: { get: async () => null, set: async () => {}, remove: async () => {} } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'idempotency-key' }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [{ id: 'image', name: 'Image', modality: 'text-to-image' }], mediaApi: () => ({ listJobs: async () => ({ jobs: [mockJob] }) }) }));
jest.mock('../src/components/VeyMascot', () => ({ VEY_CLEARANCE: 10 }));
void [RN.Pressable, RN.Text, RN.View, RN.ScrollView, RN.KeyboardAvoidingView, RN.TextInput, RN.ActivityIndicator, RN.StyleSheet];
let root: Root, alert: jest.SpyInstance;
beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); root = createRoot(); alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
    mockRequest.mockImplementation(async (path: string) => {
        if (path.endsWith('/accounts')) return { uploadsEnabled: true, accounts: [{ id: 'a', network: 'instagram', display_name: 'Studio', status: 'active', publishingEnabled: true, supportedMedia: ['image', 'video'] }] };
        if (path.endsWith('/queues')) return { queues: [{ id: 'q', name: 'Queue', enabled: true, account_ids: ['a'], slots: [] }] };
        return {};
    });
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); });
const allText = (node: TestInstance): string => node.children.map(c => typeof c === 'string' ? c : allText(c)).join(' ');
function button(label: string): TestInstance {
    const matches = root.container.queryAll(n => n.props.accessibilityRole === 'button' && allText(n).includes(label));
    expect(matches).toHaveLength(1); return matches[0];
}
async function press(label: string) {
    await act(async () => button(label).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
async function input(label: string, value: string) {
    const nodes = root.container.queryAll(n => n.props.accessibilityLabel === label);
    expect(nodes).toHaveLength(1);
    await act(async () => nodes[0].props.onChangeText(value));
}
async function ready(approval: boolean) {
    await act(async () => root.render(approval ? <ApprovalNew /> : <Compose />));
    await press('Creation A'); await press('Studio'); await press('In 1 hour');
    if (approval) await input(t('approvals.step.reviewers'), 'reviewer@example.test');
}
for (const approval of [false, true]) {
    const name = approval ? 'approval' : 'compose';
    const send = approval ? t('approvals.send') : 'Schedule';
    const sendButton = () => {
        const matches = root.container.queryAll(n => n.props.accessibilityRole === 'button' && allText(n) === send && n.props.accessibilityState?.disabled !== undefined);
        expect(matches).toHaveLength(1); return matches[0];
    };
    const submit = async () => { await act(async () => sendButton().props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); };
    test(`${name}: controlled selection clears after selected removal, preserves unselected removal and deselects on creation`, async () => {
        await ready(approval);
        await act(async () => mockPanel.onSelect({ uploadId: 'u', mediaType: 'image' }));
        expect(mockPanel.selectedUploadId).toBe('u');
        expect(sendButton().props.accessibilityState.disabled).toBe(true); // source change clears account selection
        await press('Studio'); expect(sendButton().props.accessibilityState.disabled).toBe(false);
        // A removal started under another selection must not clear the current upload.
        await act(async () => mockPanel.onSelect({ uploadId: 'other', mediaType: 'image' }));
        const removeOther = mockPanel.onSelect;
        await act(async () => mockPanel.onSelect({ uploadId: 'u', mediaType: 'image' }));
        await press('Studio');
        await act(async () => removeOther(null));
        expect(mockPanel.selectedUploadId).toBe('u'); expect(sendButton().props.accessibilityState.disabled).toBe(false);
        await act(async () => mockPanel.onSelect(null)); expect(mockPanel.selectedUploadId).toBeNull();
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'button' && allText(n) === send && n.props.accessibilityState?.disabled !== undefined)).toHaveLength(0);
        await act(async () => mockPanel.onSelect({ uploadId: 'u', mediaType: 'video' })); await press('Creation A'); expect(mockPanel.selectedUploadId).toBeNull();
    });
    test(`${name}: preparing prevents submit and a previously captured confirmation from making any request`, async () => {
        await ready(approval); await submit(); expect(alert).toHaveBeenCalledTimes(1);
        const confirm = alert.mock.calls[0][2].find((b: { onPress?: () => void }) => b.onPress).onPress;
        await act(async () => mockPanel.onBusyChange(true));
        expect(sendButton().props.accessibilityState.disabled).toBe(true);
        expect(button('Creation A').props.accessibilityState.disabled).toBe(true);
        alert.mockClear(); mockRequest.mockClear(); await submit();
        expect(alert).not.toHaveBeenCalled();
        await act(async () => confirm()); expect(mockRequest).not.toHaveBeenCalled();
    });
}
