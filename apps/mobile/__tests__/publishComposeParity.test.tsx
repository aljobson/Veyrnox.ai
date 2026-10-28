import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Compose from '../src/app/(app)/publish/compose';
import ApprovalNew from '../src/app/(app)/publish/approval-new';
import { MediaLibraryGrid } from '../src/components/publish/MediaLibraryGrid';
import { ChosenMediaPreview } from '../src/components/publish/ChosenMediaPreview';
import { t } from '../src/lib/i18n';
import { brandStore } from '../src/lib/publishBrand';
import type { ApiClient } from '../src/lib/api';
import type { CreationPick } from '../src/lib/publishMediaChoice';
import { buttons, input, press, textOf, deferred, OTHER } from './publishDepthTestHelpers';

const mockRequest = jest.fn(), mockAsset = jest.fn(), mockPush = jest.fn();
const mockApi = { request: mockRequest } as unknown as ApiClient;
const mockJobs = [{ job_id: 'image-job', model_id: 'image', label: 'Creation image', state: 'succeeded', has_asset: true, created_at: '2026-10-21' }, { job_id: 'video-job', model_id: 'video', label: 'Creation video', state: 'succeeded', has_asset: true, created_at: '2026-10-21' }];
let mockState: Record<string, unknown>;
jest.mock('../src/lib/usePublishApi', () => ({ usePublishApi: () => mockApi }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({}), useRouter: () => ({ replace: jest.fn(), push: mockPush }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-key' }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {}, appStorage: { get: async () => null, set: async () => {}, remove: async () => {} } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [{ id: 'image', name: 'Image', modality: 'text-to-image' }, { id: 'video', name: 'Video', modality: 'text-to-video' }], mediaApi: () => ({ listJobs: async () => ({ jobs: mockJobs }), getAsset: (...args: unknown[]) => mockAsset(...args) }) }));
jest.mock('../src/components/PublishUploadPanel', () => ({ PublishUploadPanel: () => null }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ status: 'readyToPlay', addListener: () => ({ remove: jest.fn() }) }), VideoView: (props: object) => { const { View } = require('react-native'); return <View {...props} />; } }));
jest.mock('../src/components/InlineMedia', () => ({ InlineMedia: ({ label }: { label: string }) => { const { View } = require('react-native'); return <View accessibilityLabel={label} />; } }));
void [RN.Pressable, RN.TextInput, RN.Text, RN.View, RN.ScrollView, RN.StyleSheet, RN.ActivityIndicator, RN.KeyboardAvoidingView];
const account = (id: string, network = 'instagram') => ({ id, network, display_name: `Studio ${id}`, status: 'active', publishingEnabled: true, supportedMedia: ['image', 'video'] });
let root: Root, alert: jest.SpyInstance;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; brandStore.set(null); jest.clearAllMocks(); root = createRoot();
    mockState = { brandRole: 'owner', plansEnabled: true, planTier: 'publish', variantsEnabled: true, queuesEnabled: true, contentPresetsEnabled: true, accounts: [account('a'), account('b', 'twitter')] };
    mockAsset.mockResolvedValue({ url: 'https://example.test/asset.png' });
    mockRequest.mockImplementation(async (path: string) => path.endsWith('/accounts') ? mockState : path.endsWith('/queues') ? { queues: [{ id: 'q', name: 'Queue A', enabled: true, account_ids: ['a'], slots: [] }] } : {});
    alert = jest.spyOn(RN.Alert, 'alert').mockImplementation(() => {});
});
afterEach(async () => { await act(async () => root.unmount()); alert.mockRestore(); brandStore.set(null); });
async function start(approval = false) { await act(async () => root.render(approval ? <ApprovalNew /> : <Compose />)); }
async function starts(label: string) {
    const found = root.container.queryAll(node => node.props.accessibilityRole === 'button' && textOf(node).startsWith(label));
    expect(found).toHaveLength(1); await act(async () => found[0].props.onClick({ nativeEvent: {} }));
}
async function sendNow() {
    const send = buttons(root, t('publish.postnow2')).find(node => node.props.accessibilityState?.disabled !== undefined)!;
    expect(send).toBeDefined(); await act(async () => send.props.onClick({ nativeEvent: {} }));
    const confirm = alert.mock.calls.at(-1)?.[2].find((b: { onPress?: () => void }) => b.onPress);
    expect(confirm).toBeDefined(); await act(async () => confirm.onPress());
    return JSON.parse(mockRequest.mock.calls.find(([path, init]) => path === '/api/v1/social/posts' && init?.method === 'POST')![1].body);
}
test('free plan hides forbidden controls, replaces selection, and posts only allowed fields', async () => {
    mockState.planTier = 'free'; await start(); await starts('Creation image'); await starts('Studio a'); await starts('Studio b');
    const selected = root.container.queryAll(n => n.props.accessibilityRole === 'button' && textOf(n).startsWith('Studio') && n.props.accessibilityState.selected);
    expect(selected).toHaveLength(1); expect(textOf(selected[0])).toContain('Studio b');
    expect(buttons(root, t('publish.schedule'))).toHaveLength(0); expect(buttons(root, t('compose.queue'))).toHaveLength(0);
    expect(textOf(root.container)).toContain(t('publishCompose.schedulingneedsthePublishPlanYoucan'));
    expect(textOf(root.container)).toContain(t('publishCompose.postingtomorethanoneaccountneeds'));
    expect(textOf(root.container)).toContain(t('publishCompose.differenttextforeachnetworkneedsthe'));
    expect(mockRequest.mock.calls.some(([path]) => path.endsWith('/queues'))).toBe(false);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('publishDepth.presets.name'))).toHaveLength(0);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('compose.networkText', { network: 'X' }))).toHaveLength(0);
    await press(root, t('publishParity.plan.see')); expect(mockPush).toHaveBeenCalledWith('/publish');
    await input(root, t('publish.caption'), 'Main caption');
    const body = await sendNow(); expect(body).toMatchObject({ publishNow: true, accountIds: ['b'], globalText: 'Main caption' });
    expect(body).not.toHaveProperty('scheduledAt'); expect(body).not.toHaveProperty('networkText');
});
test.each([false, true])('YouTube visibility flag %s controls UI and outgoing body', async flag => {
    mockState = { ...mockState, planTier: 'free', youtubeVisibilityEnabled: flag, accounts: [account('a', 'youtube')] };
    await start(); await starts('Creation video'); await starts('Studio a');
    if (flag) {
        await press(root, t('compose.youtube.unlisted'));
        expect(textOf(root.container)).toContain(t('publishParity.youtube.unlisted'));
        expect(textOf(root.container)).toContain(t('publishParity.youtube.only'));
    } else {
        expect(buttons(root, t('compose.youtube.private'))).toHaveLength(0);
        expect(textOf(root.container)).toContain(t('publishParity.youtube.publicDefault'));
    }
    await input(root, t('publish.caption'), 'Video caption'); const body = await sendNow();
    if (flag) expect(body.youtubeVisibility).toBe('unlisted'); else expect(body).not.toHaveProperty('youtubeVisibility');
});
test('paid previews use overrides and main caption, count code points, and flag over-limit captions', async () => {
    await start(); await starts('Creation image'); await starts('Studio a'); await starts('Studio b');
    await input(root, t('publish.caption'), 'Main caption'); await input(root, t('compose.networkText', { network: 'X' }), '😀'.repeat(281));
    const preview = (network: string) => root.container.queryAll(n => n.props.accessibilityLabel === t('publishParity.preview.label', { network }))[0];
    expect(textOf(preview('Instagram'))).toContain('Main caption'); expect(textOf(preview('Instagram'))).toContain(t('publishParity.preview.main'));
    expect(textOf(preview('X'))).toContain('😀'.repeat(281)); expect(textOf(preview('X'))).toContain(t('publishParity.preview.own'));
    const counter = preview('X').queryAll(n => textOf(n) === t('compose.networkTextCount', { count: 281, limit: 280 }) && !!n.props.style).at(-1)!;
    const normal = preview('Instagram').queryAll(n => textOf(n) === t('compose.networkTextCount', { count: 12, limit: 2200 }) && !!n.props.style).at(-1)!;
    expect(RN.StyleSheet.flatten(counter.props.style).color).not.toBe(RN.StyleSheet.flatten(normal.props.style).color);
});
test('queue destinations supply previews and TikTok video explains draft delivery', async () => {
    mockState.accounts = [account('a', 'tiktok')]; await start(); await starts('Creation video'); await press(root, t('compose.queue')); await starts('Queue A');
    expect(textOf(root.container)).toContain(t('publishParity.preview.tiktok'));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === t('publishParity.preview.label', { network: 'TikTok' }))).toHaveLength(1);
});
test.each([false, true])('viewer only sees the read-only message (approval: %s)', async approval => {
    mockState.brandRole = 'viewer'; await start(approval);
    expect(textOf(root.container)).toBe(t('publishParity.compose.readOnly'));
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button')).toHaveLength(0);
});
const pick = { kind: 'job', job: mockJobs[0], mediaType: 'image', name: 'Creation image' } as CreationPick;
test.each(['success', 'reject', 'throw'])('grid asset %s degrades quietly and announces selection', async result => {
    if (result === 'reject') mockAsset.mockRejectedValue(new Error('offline'));
    if (result === 'throw') mockAsset.mockImplementation(() => { throw new Error('sync failure'); });
    await act(async () => root.render(<MediaLibraryGrid api={mockApi} picks={[pick]} choices={[pick]} max={1} disabled={false} onToggle={jest.fn()} />));
    const tile = root.container.queryAll(n => n.props.accessibilityRole === 'button')[0];
    expect(tile.props.accessibilityState).toMatchObject({ selected: true, disabled: false });
    const remote = root.container.queryAll(n => JSON.stringify(n.props.source ?? '').includes('https://example.test/asset.png'));
    expect(remote.length > 0).toBe(result === 'success');
    expect(textOf(root.container)).toContain('Creation image');
});
test('late media URL cannot reappear after a scope change; uploads show a placeholder', async () => {
    const wait = deferred<{ url: string }>(); mockAsset.mockReturnValue(wait.promise);
    await act(async () => root.render(<ChosenMediaPreview api={mockApi} choice={pick} />));
    await act(async () => brandStore.set(OTHER)); await act(async () => wait.resolve({ url: 'https://example.test/old.png' }));
    expect(root.container.queryAll(n => JSON.stringify(n.props.source ?? '').includes('https://example.test/old.png'))).toHaveLength(0);
    await act(async () => root.render(<ChosenMediaPreview api={mockApi} choice={{ kind: 'upload', uploadId: 'u', mediaType: 'image' }} />));
    expect(textOf(root.container)).toContain(t('publishParity.media.upload'));
});
