import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FacelessSoundCard } from '../src/components/FacelessSoundCard';
import { fetchCatalogCached } from '../src/lib/media';
import { readCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
import { FACELESS_SOUND_PROMPT } from '../src/lib/facelessReel';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: jest.fn() }));
void [RN.View, RN.Text, RN.Pressable];
let root: Root;
const props = { jobId: 'job', followup: 'faceless-sound', state: 'succeeded', modelId: 'wan-2.5-kie', mime: 'video/mp4' };
const model = { id: 'mmaudio-v2-video', name: 'Sound', gated: false, credits: 1, modality: 'video-to-audio', durations: [], capabilities: { media: { video: { required: true } } } };
const action = () => root.container.queryAll(n => n.props.accessibilityLabel === t('facelessReel.soundPassAction'));
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockPush.mockClear();
    jest.mocked(fetchCatalogCached).mockImplementation(async cb => { cb?.([model], {} as any); return {} as any; });
});
afterEach(async () => { await act(async () => root.unmount()); });
test.each([{ followup: undefined },{ state: 'running' },{ state: 'failed' },{ modelId: 'other' },{ mime: 'image/png' },{ mime: undefined }])('hides for an ineligible result %s', async patch => {
    await act(async () => root.render(<FacelessSoundCard {...props} {...patch} />)); expect(action()).toHaveLength(0);
});
test.each(['missing', 'slot', 'gated', 'failure'])('hides when catalog is %s', async state => {
    jest.mocked(fetchCatalogCached).mockImplementation(async cb => {
        if (state === 'failure') throw Error('offline');
        cb?.(state === 'missing' ? [] : [{ ...model, gated: state === 'gated', capabilities: state === 'slot' ? {} : model.capabilities }], {} as any); return {} as any;
    });
    await act(async () => root.render(<FacelessSoundCard {...props} />)); expect(action()).toHaveLength(0);
});
test('stages the completed video with fresh consent and the English sound prompt', async () => {
    await act(async () => root.render(<FacelessSoundCard {...props} />));
    await act(async () => action()[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    const params = mockPush.mock.calls[0][0].params;
    expect(params).toMatchObject({ modelId: 'mmaudio-v2-video', recipe: 'faceless-sound', prompt: FACELESS_SOUND_PROMPT });
    expect(readCreativeSourceHandoff(params.sourceHandoff, params.recipe, params.modelId)).toMatchObject({ references: [{ slot: 'video', origin: 'asset', asset_id: 'job' }], rightsConfirmed: false, uploaded: {}, fromLibrary: {} });
});
