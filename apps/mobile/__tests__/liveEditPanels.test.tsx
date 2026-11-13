import { act } from 'react';
import { createRoot } from 'test-renderer';
import { router } from 'expo-router';
import { AiWigPanel, HairPanel, MakeupPanel, RetouchPanel, type PanelProps } from '../src/components/liveEdit/Panels';
import { ToolStrip } from '../src/components/liveEdit/ToolStrip';
import { normalizeStack, DEFAULT_STACK } from '../src/lib/liveEdit/engine';
import { t } from '../src/lib/i18n';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
type Props = PanelProps;
const base = (over: Partial<Props> = {}): Props => ({ stack: DEFAULT_STACK, onChange: jest.fn(), onChangeStart: jest.fn(), onChangeEnd: jest.fn(), face: true, hair: true, disabled: false, ...over });
const flat = <T,>(nodes: T[]) => nodes;
const tap = (node: { props: Record<string, unknown> }) => (node.props.onClick as (e: unknown) => void)({ nativeEvent: {}, currentTarget: 1, target: 1 });
async function mount(ui: React.ReactElement) {
    const root = createRoot();
    await act(async () => root.render(ui));
    const all = (pred: (props: Record<string, unknown>) => boolean) => root.container.queryAll(n => pred(n.props as Record<string, unknown>));
    const dial = (label: string) => flat(all(p => p.accessibilityRole === 'adjustable' && p.accessibilityLabel === label))[0]!;
    const radios = (label: string) => all(p => p.accessibilityRole === 'radio' && p.accessibilityLabel === label);
    return { root, all, dial, radios };
}
const stateOf = (node: { props: Record<string, unknown> }) => node.props.accessibilityState as { disabled?: boolean; selected?: boolean };

test('the retouch dial changes the smoothing by ten percent and locks without exactly one face', async () => {
    const props = base();
    const { root, dial } = await mount(<RetouchPanel {...props} />);
    await act(async () => (dial(t('liveEdit.smoothing')).props.onAccessibilityAction as (e: unknown) => void)({ nativeEvent: { actionName: 'increment' } }));
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ smoothing: DEFAULT_STACK.smoothing + 0.1 }));
    await act(async () => root.unmount());
    const locked = await mount(<RetouchPanel {...base({ face: false })} />);
    expect(stateOf(locked.dial(t('liveEdit.smoothing'))).disabled).toBe(true);
    await act(async () => locked.root.unmount());
});

test('makeup starts on lips, picks a shade and a finish, and locks every control without a face', async () => {
    const props = base();
    const { root, dial, radios, all } = await mount(<MakeupPanel {...props} />);
    const lips = dial(t('liveEdit.lips'));
    expect(stateOf(lips).disabled).toBe(false);
    await act(async () => tap(radios(t('liveEdit.shade', { n: '2' }))[0]!));
    expect(props.onChange).toHaveBeenCalledWith(expect.objectContaining({ makeup: expect.objectContaining({ lips: expect.objectContaining({ shade: expect.any(String) }) }) }));
    const gloss = all(p => p.accessibilityRole === 'tab' && p.accessibilityLabel === t('liveEdit.gloss'));
    expect(gloss.length).toBeGreaterThan(0);
    await act(async () => root.unmount());
    const off = await mount(<MakeupPanel {...base({ face: false })} />);
    expect(stateOf(off.dial(t('liveEdit.lips'))).disabled).toBe(true);
    expect(off.radios(t('liveEdit.shade', { n: '1' })).every(n => stateOf(n).disabled === true)).toBe(true);
    await act(async () => off.root.unmount());
});

test('hair colour stays locked until a hair mask exists, and the second shade only appears for ombre and highlights', async () => {
    const without = await mount(<HairPanel {...base({ hair: false })} live={false} />);
    expect(stateOf(without.dial(t('liveEdit.hair'))).disabled).toBe(true);
    expect(without.radios(t('liveEdit.shade', { n: '1' })).every(n => stateOf(n).disabled === true)).toBe(true);
    await act(async () => without.root.unmount());
    const solid = await mount(<HairPanel {...base()} live={false} />);
    expect(stateOf(solid.dial(t('liveEdit.hair'))).disabled).toBe(false);
    expect(solid.radios(t('liveEdit.secondShade', { n: '1' }))).toHaveLength(0);
    await act(async () => solid.root.unmount());
    const ombre = await mount(<HairPanel {...base({ stack: normalizeStack({ hair: { mode: 'ombre' } as never }) })} live={false} />);
    expect(ombre.radios(t('liveEdit.secondShade', { n: '1' })).length).toBeGreaterThan(0);
    await act(async () => ombre.root.unmount());
});

test('live camera explains that hair colour is not shown live', async () => {
    const { root, all } = await mount(<HairPanel {...base({ hair: false })} live />);
    expect(all(p => p.children === t('liveEdit.camera.hairNote')).length).toBeGreaterThan(0);
    await act(async () => root.unmount());
});

test('the AI wig panel only opens the existing Face Filters flow, which shows the price and asks for consent', async () => {
    const { root, all } = await mount(<AiWigPanel />);
    const open = all(p => typeof p.onClick === 'function' && p.accessibilityLabel === t('liveEdit.aiWig.open'))[0]!;
    await act(async () => tap(open));
    expect(router.push).toHaveBeenCalledWith('/face-filters');
    await act(async () => root.unmount());
});

test('the tool strip marks the current tool and reports the one tapped', async () => {
    const onChange = jest.fn();
    const { root, all } = await mount(<ToolStrip value="makeup" onChange={onChange} />);
    const tabs = all(p => p.accessibilityRole === 'tab');
    expect(tabs).toHaveLength(5);
    expect(tabs.filter(n => stateOf(n).selected === true)).toHaveLength(1);
    const hair = tabs.find(n => n.props.accessibilityLabel === t('liveEdit.tool.hair'))!;
    await act(async () => tap(hair));
    expect(onChange).toHaveBeenCalledWith('hair');
    await act(async () => root.unmount());
});
