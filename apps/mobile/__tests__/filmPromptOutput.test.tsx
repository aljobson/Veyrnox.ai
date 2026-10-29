import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { FilmPromptOutput } from '../src/components/film/FilmPromptOutput';
import { copyText } from '../src/lib/clipboard';
import type { CatalogModel } from '../src/lib/media';
import { t } from '../src/lib/i18n';
const mockPush = jest.fn(), mockRouter = { push: mockPush };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('../src/lib/clipboard', () => ({ copyText: jest.fn() }));
void [RN.Text, RN.Pressable, RN.View, RN.TextInput, RN.StyleSheet];
const model: CatalogModel = { id: 'video', name: 'Video', modality: 'text-to-video', credits: 1, gated: false, durations: [10], capabilities: { inputs: { prompt: { max: 100 }, aspect_ratio: { values: ['16:9'] } } } };
let root: Root;
const props = { title: 'Output', prompt: 'Full prompt\nwith all lines', modelId: 'video', access: 'Studio', catalog: [model], live: true, aspect: '16:9', duration: 10 };
const textOf = (n: any): string => n.children.map((v: any) => typeof v === 'string' ? v : textOf(v)).join('');
const button = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
const press = async (label: string) => act(async () => button(label).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
const render = async (over: Partial<typeof props> = {}) => act(async () => root.render(<FilmPromptOutput {...props} {...over} />));
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.clearAllMocks();
    jest.spyOn(RN.AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    jest.spyOn(RN.Share, 'share').mockResolvedValue({ action: RN.Share.sharedAction, activityType: undefined });
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
test('Create receives the complete prompt, aspect and duration; Share receives full text', async () => {
    await render(); await press(t('film.openinCreate'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/create/[modelId]', params: { modelId: 'video', prompt: props.prompt, aspect: '16:9', duration: '10' } });
    await press(t('film.sharethefullprompt')); expect(RN.Share.share).toHaveBeenCalledWith({ message: props.prompt });
    expect(root.container.queryAll(n => n.props.selectable)).toHaveLength(1);
});
test.each([
    [{ live: false }, 'catalog'], [{ catalog: [] }, 'catalog'], [{ catalog: [{ ...model, gated: true }] }, 'catalog'],
    [{ prompt: 'x'.repeat(101) }, 'limit'], [{ duration: 12 }, 'duration'], [{ aspect: '9:16' }, 'aspect'],
    [{ catalog: [{ ...model, capabilities: { inputs: { prompt: { max: 0 } } } }] }, 'limit'],
    ...['clips', 'topic', 'plan_id'].map(key => [{ catalog: [{ ...model, capabilities: { inputs: { prompt: { max: 100 }, [key]: {} } } }] }, 'catalog']),
] as [Partial<typeof props>, string][])('Open is absent and reason is shown for %p', async (over, reason) => {
    await render(over); expect(button(t('film.openinCreate'))).toBeUndefined();
    expect(textOf(root.container)).toContain(t(`filmOutput.reason.${reason}`, { value1: over.catalog ? 0 : 100 }));
});
test('External hides both Open and the Studio-only reason', async () => {
    await render({ access: 'External' }); expect(button(t('film.openinCreate'))).toBeUndefined();
    expect(textOf(root.container)).not.toContain(t('filmOutput.reason.catalog'));
});
test.each([true, false])('Copy announces success=%p', async ok => {
    jest.mocked(copyText).mockResolvedValue(ok); await render(); await press(t('filmOutput.copy'));
    expect(copyText).toHaveBeenCalledWith(props.prompt);
    expect(RN.AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(t(ok ? 'filmOutput.copied' : 'filmOutput.copyFailed'));
});


test('a catalog without an explicit prompt maximum uses the 30000-character generation default', async () => {
    const catalog = [{ ...model, capabilities: { inputs: { prompt: {}, aspect_ratio: { values: ['16:9'] } } } }];
    await render({ catalog, prompt: 'x'.repeat(30000) });
    expect(button(t('film.openinCreate'))).toBeDefined();
    await render({ catalog, prompt: 'x'.repeat(30001) });
    expect(button(t('film.openinCreate'))).toBeUndefined();
    expect(textOf(root.container)).toContain(t('filmOutput.reason.limit', { value1: 30000 }));
});
