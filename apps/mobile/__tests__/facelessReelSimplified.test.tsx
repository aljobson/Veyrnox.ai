import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Screen from '../src/app/(app)/faceless-reel';
import { fetchCatalogCached } from '../src/lib/media';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush }) }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: jest.fn() }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable];
let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const byLabel = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const control = (key: string, vars?: Record<string, string | number>) => byLabel(t(key, vars));
const visible = (value: string) => root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(value)));
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockPush.mockClear();
    jest.mocked(fetchCatalogCached).mockImplementation(async callback => { callback?.([{ id: 'wan-2.5-kie', name: 'Wan', gated: false, modality: 'text-to-video', credits: 1, durations: [5, 10], capabilities: { inputs: { prompt: { max: 800 } } } }], {} as any); return {} as any; });
});
afterEach(async () => { await act(async () => root.unmount()); });
const render = async () => act(async () => root.render(<Screen />));
const press = async (label: string) => act(async () => byLabel(label).props.onClick(event));
test('the brief box is the first interactive element, under one short line', async () => {
    await render();
    const first = root.container.queryAll(n => typeof n.props.onChangeText === 'function' || typeof n.props.onClick === 'function')[0];
    expect(first.props.accessibilityLabel).toBe(t('facelessReel.briefLabel'));
    expect(visible(t('facelessReel.lead')).length).toBeGreaterThan(0);
    expect(visible(t('facelessReel.step1')).length).toBeGreaterThan(0);
    expect(control('facelessReel.next')).toBeDefined();
});
test('the model contract is collapsed by default and expands', async () => {
    await render();
    const toggle = control('facelessReel.howTitle');
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    expect(visible('Wan 2.5')).toHaveLength(0);
    await act(async () => toggle.props.onClick(event));
    expect(control('facelessReel.howTitle').props.accessibilityState).toMatchObject({ expanded: true });
    expect(visible(t('facelessReel.contract')).length).toBeGreaterThan(0);
});
test('no jargon is visible while collapsed, on any step', async () => {
    await render();
    const jargon = ['MMAudio', 'visual master', 'Wan 2.5', 'model contract'];
    const check = () => { const all = JSON.stringify(root.container.queryAll(() => true).flatMap(n => n.children.filter(c => typeof c === 'string'))); for (const word of jargon) expect(all).not.toContain(word); };
    check();
    await act(async () => control('facelessReel.briefLabel').props.onChangeText('A coffee cup steaming in a quiet café at dawn'));
    await press(t('facelessReel.next')); check();
    expect(visible(t('facelessReel.step2')).length).toBeGreaterThan(0);
    await press(t('facelessReel.next')); check();
    expect(visible(t('facelessReel.step3')).length).toBeGreaterThan(0);
});
test('the example chip fills the brief, and Next on a short brief shows the existing error', async () => {
    await render();
    await press(t('facelessReel.next'));
    expect(visible(t('facelessReel.error.topicShort')).length).toBeGreaterThan(0);
    await act(async () => byLabel(t('facelessReel.example')).props.onClick(event));
    expect(control('facelessReel.briefLabel').props.value).toBe(t('facelessReel.example'));
});
test('step 3 states nothing is charged, price first, and refunds, before Create', async () => {
    await render();
    await act(async () => control('facelessReel.briefLabel').props.onChangeText('A coffee cup steaming in a quiet café at dawn'));
    await press(t('facelessReel.next')); await press(t('facelessReel.next'));
    expect(visible(t('facelessReel.noSpend')).length).toBeGreaterThan(0);
    expect(t('facelessReel.noSpend')).toMatch(/refund/i);
    expect(control('facelessReel.openCreate')).toBeDefined();
});
