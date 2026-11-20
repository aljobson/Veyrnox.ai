import { act } from 'react';
import * as RN from 'react-native';
import { createRoot } from 'test-renderer';
import CreativeFeatureDetail from '../src/app/(app)/features/[slug]';
import { lipSyncSourceHref, readCreativeReuse } from '../src/lib/creativeReuse';
const mockParams = lipSyncSourceHref('job_123').params;
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => mockParams, useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: {} }) }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({}), VideoView: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [{ id: 'latentsync' }] }));
jest.mock('../src/lib/sources', () => ({ ...jest.requireActual('../src/lib/sources'), requiredNamedSlots: () => [{ slot: 'video', required: true }, { slot: 'audio', required: true }] }));
jest.mock('../src/components/SourcePicker', () => ({ SourcePicker: (props: any) => jest.requireActual('react').createElement('SourcePicker', props) }));
void [RN.View, RN.Pressable, RN.Text, RN.ScrollView, RN.TextInput];
test('shortcut parses into the existing studio and pre-attaches only the audio reference', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    expect(readCreativeReuse(mockParams.sourceJobId, mockParams.sourceKind)).toEqual({ jobId: 'job_123', kind: 'audio' });
    const root = createRoot();
    try {
        await act(async () => root.render(<CreativeFeatureDetail />));
        const pickers = root.container.queryAll(n => n.type === 'SourcePicker');
        expect(pickers.find(n => n.props.slot.slot === 'audio')?.props.references).toEqual([{ slot: 'audio', origin: 'asset', asset_id: 'job_123' }]);
        expect(pickers.find(n => n.props.slot.slot === 'audio')?.props.initialReady).toBe(true);
        expect(pickers.find(n => n.props.slot.slot === 'video')?.props.references).toEqual([]);
    } finally { await act(async () => root.unmount()); }
});
test.each(['../job', '', 'a'.repeat(65), ['job'], null])('invalid source id %p is refused', id => {
    expect(readCreativeReuse(id, 'audio')).toBeNull();
});
