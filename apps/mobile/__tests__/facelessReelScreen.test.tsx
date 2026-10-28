import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/faceless-reel';
import { fetchCatalogCached } from '../src/lib/media';
import { briefRoom } from '../src/lib/facelessReel';
import { readCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: jest.fn() }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable];
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const control = (key: string) => root.container.queryAll(n => n.props.accessibilityLabel === t(key))[0];
const press = async (key: string) => act(async () => control(key).props.onClick(event));
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockPush.mockClear();
    jest.mocked(fetchCatalogCached).mockImplementation(async callback => { callback?.([{ id: 'wan-2.5-kie', name: 'Wan', gated: false, modality: 'text-to-video', credits: 1, durations: [5,10], capabilities: { inputs: { prompt: { max: 800 } } } }], {} as any); return {} as any; });
});
afterEach(async () => { await act(async () => root.unmount()); });
const render = async () => act(async () => root.render(<Screen />));
const fill = async (value: string) => act(async () => control('facelessReel.briefLabel').props.onChangeText(value));
const attest = async () => { await press('facelessReel.originality'); await press('facelessReel.noImitation'); };
test('short brief shows a translated error without navigating', async () => {
    await render(); await fill('short'); await press('facelessReel.openCreate');
    expect(text(t('facelessReel.error.topicShort')).length).toBeGreaterThan(0); expect(mockPush).not.toHaveBeenCalled();
});
test('sound is cleared and disabled at 10 seconds', async () => {
    await render(); await press('facelessReel.soundTitle');
    expect(control('facelessReel.soundTitle').props.accessibilityState.checked).toBe(true);
    await act(async () => root.container.queryAll(n => n.props.accessibilityLabel === t('facelessReel.seconds', { n: 10 }))[0].props.onClick(event));
    expect(control('facelessReel.soundTitle').props.accessibilityState).toMatchObject({ disabled: true, checked: false });
    await fill('Original scenery over a quiet mountain'); await attest(); await press('facelessReel.openCreate');
    const params = mockPush.mock.calls[0][0].params;
    expect(params.duration).toBe('10'); expect(readCreativeSourceHandoff(params.sourceHandoff, params.recipe, params.modelId)?.followup).toBeUndefined();
});
test('Web transfers 16:9 and the 5-second sound intent in an in-memory token', async () => {
    await render(); await fill('Original scenery over a quiet mountain'); await attest(); await press('facelessReel.soundTitle');
    await act(async () => root.container.queryAll(n => n.props.accessibilityLabel === `${t('facelessReel.platform.web')}. 16:9`)[0].props.onClick(event));
    await press('facelessReel.openCreate');
    const params = mockPush.mock.calls[0][0].params;
    expect(params).toMatchObject({ modelId: 'wan-2.5-kie', duration: '5', recipe: 'faceless-reel', prompt: expect.stringContaining('Original scenery') });
    expect(readCreativeSourceHandoff(params.sourceHandoff, params.recipe, params.modelId)).toMatchObject({ aspect: '16:9', followup: 'generated-sound', rightsConfirmed: false });
});
test('adding a hook over budget leaves maxLength fixed and shortening immediately enables Open', async () => {
    await render(); const values = { topic: '', duration: 5, format: 'explainer', pacing: 'balanced', platform: 'reels' };
    const room = briefRoom(values, 800); await fill('b'.repeat(room));
    await act(async () => control('facelessReel.hookAria').props.onChangeText('h'.repeat(100)));
    const nextRoom = briefRoom({ ...values, hook: 'h'.repeat(100) },800);
    expect(control('facelessReel.briefLabel').props.maxLength).toBe(800);
    expect(control('facelessReel.openCreate').props.accessibilityState.disabled).toBe(true);
    expect(text(t('facelessReel.error.promptLong', { max: 800 })).length).toBeGreaterThan(0);
    expect(root.container.queryAll(n => n.props.accessibilityLiveRegion === 'polite' && n.children.some(c => typeof c === 'string' && c.includes(t('facelessReel.over', { over: room - nextRoom })))).length).toBeGreaterThan(0);
    await fill('b'.repeat(nextRoom)); expect(control('facelessReel.openCreate').props.accessibilityState.disabled).toBe(false);
});
test.each(['missing','failed','loading'])('%s catalog disables Open', async state => {
    jest.mocked(fetchCatalogCached).mockImplementation(async callback => {
        if (state === 'failed') throw Error('offline');
        if (state === 'missing') callback?.([], {} as any);
        return {} as any;
    });
    await render(); expect(control('facelessReel.openCreate').props.accessibilityState.disabled).toBe(true);
    if (state !== 'loading') expect(text(t('facelessReel.unavailable')).length).toBeGreaterThan(0);
});
