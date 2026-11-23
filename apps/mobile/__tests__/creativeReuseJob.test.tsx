import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import JobScreen from '../src/app/(app)/job/[id]';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
const mockClient = {};
const mockPush = jest.fn();
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockClient }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: () => null, useLocalSearchParams: () => ({ id: mockId }), useRouter: () => ({ replace: jest.fn(), push: mockPush }) }));
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
jest.mock('../src/lib/celebrate', () => ({ ...jest.requireActual('../src/lib/celebrate'), celebrateOutput: jest.fn(), afterCelebration: jest.fn() }));
void [RN.ActivityIndicator, RN.View, RN.Text, RN.StyleSheet, RN.ScrollView, RN.Pressable];
let root: Root;
const file = { url: 'https://file', mime_type: 'image/png' };
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
async function render() { await act(async () => root.render(<JobScreen />)); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); mockApi.getJob.mockReset(); mockApi.getAsset.mockReset(); mockId = 'held';
    mockApi.getJob.mockResolvedValue({ state: 'succeeded', model_id: 'm' });
    mockApi.getAsset.mockRejectedValue(new ApiError(404, 'held'));
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });

const shortcut = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === t('library.useForLipSync'));
test('audio lookup enables direct lip sync and expiry while mounted removes it', async () => {
    mockApi.getAsset.mockResolvedValue({ ...file, mime_type: 'audio/mpeg', asset_expires_at: new Date(Date.now() + 30_000).toISOString() });
    await render(); expect(shortcut()).toHaveLength(1);
    await act(async () => shortcut()[0].props.onClick({ nativeEvent: {} }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/features/[slug]', params: { slug: 'lip-sync', sourceJobId: mockId, sourceKind: 'audio' } });
    expect(text(t('job.next.reuse'))).toHaveLength(1);
    await act(async () => { await jest.advanceTimersByTimeAsync(60_000); });
    expect(shortcut()).toHaveLength(0);
});
test.each(['image/png', 'video/mp4'])('non-audio %s has no shortcut', async mime_type => {
    mockApi.getAsset.mockResolvedValue({ ...file, mime_type }); await render(); expect(shortcut()).toHaveLength(0);
});
test.each(['held', 'not_found', 'upstream_error'])('failed asset lookup %s has no shortcut', async code => {
    mockApi.getAsset.mockRejectedValue(new ApiError(code === 'upstream_error' ? 502 : 404, code)); await render(); expect(shortcut()).toHaveLength(0);
});
test('already expired audio has no shortcut', async () => {
    mockApi.getAsset.mockResolvedValue({ ...file, mime_type: 'audio/mpeg', asset_expires_at: new Date(Date.now() - 1).toISOString() });
    await render(); expect(shortcut()).toHaveLength(0);
});
test('pending lookup has no shortcut', async () => {
    mockApi.getAsset.mockImplementation(() => new Promise(() => {})); await render(); expect(shortcut()).toHaveLength(0);
});
