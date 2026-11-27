import { act } from 'react';
import { View, Text, Pressable, TextInput, Switch } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { MotionPanel } from '../src/components/editor/tools/MotionPanel';
import { MaskPanel } from '../src/components/editor/tools/MaskPanel';
import { useLookActions } from '../src/components/editor/tools/useLookActions';
import { useMotionActions } from '../src/components/editor/tools/useMotionActions';
import { useMaskActions } from '../src/components/editor/tools/useMaskActions';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import { timelineOf, type Selection } from '../src/lib/nativeEditorModel';
import { colourDefaults } from '../../../app/veyrnox/_lib/editorColour.mjs';
import { evaluatedParameters, evaluatedTransform, FILTER_DEFAULTS, motionPreset, parameterKeyframe } from '../../../app/veyrnox/_lib/editorAnimation.mjs';
import { webSequenceV3 } from './fixtures/webSequenceV3';
void [View, Text, Pressable, TextInput, Switch];
let root: Root;
const tl = timelineOf(webSequenceV3()), frameStore = createFrameStore(), applyTimeline = jest.fn(() => true), setFrame = jest.fn(), setPlaying = jest.fn();
let selection: Selection | null, renders = 0;
function Harness() {
    renders++;
    const props = { timeline: tl, selection, applyTimeline, patchSelected: jest.fn(), setProblem: jest.fn(), frameStore };
    const motionActions = useMotionActions({ ...props, setFrame, setPlaying }), maskActions = useMaskActions(props);
    return <><MotionPanel {...props} motionActions={motionActions} /><MaskPanel {...props} maskActions={maskActions} /></>;
}
const text = (value: string) => root.container.queryAll(n => n.children.includes(value)).length > 0;
async function press(label: string) {
    const nodes = root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function');
    expect(nodes).toHaveLength(1);
    await act(async () => nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
beforeEach(() => { root = createRoot(); selection = { track: 'video', id: 'v1' }; jest.clearAllMocks(); frameStore.set(0); });
afterEach(async () => { await act(async () => root.unmount()); });
test('video panels expose named controls and headings, Push in commits exactly one web preset', async () => {
    await act(async () => root.render(<Harness />));
    for (const title of ['Transform', 'Motion path and keyframes', 'Picture keys', 'Mask', 'Smart picture']) {
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'header' && n.children.includes(title))).toHaveLength(1);
    }
    for (const node of root.container.queryAll(n => ['button', 'adjustable', 'switch', 'radiogroup'].includes(n.props.accessibilityRole))) {
        expect(node.props.accessibilityLabel).toBeTruthy();
        if (node.props.accessibilityRole === 'adjustable') expect(node.props.accessible).toBe(true);
    }
    for (const label of ['Invert mask', 'Remove background by colour']) {
        expect(root.container.queryAll(n => n.children.includes(label) && n.props.accessible === false)).toHaveLength(1);
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'switch' && n.props.accessibilityLabel === label)).toHaveLength(1);
    }
    await press('Push in'); await press('Apply motion path'); expect(applyTimeline).toHaveBeenCalledTimes(1);
    const result = (applyTimeline.mock.calls as unknown as [[typeof tl]])[0][0];
    expect(result.video[0].keyframes).toEqual(motionPreset(tl.video[0], 'push-in'));
    const count = renders; await act(async () => frameStore.set(30)); expect(renders).toBe(count);
});
test.each(['text', 'audio', 'empty'] as const)('%s selection exposes only applicable sections', async kind => {
    selection = kind === 'empty' ? null : { track: kind, id: kind === 'text' ? 't3' : 'a1' };
    await act(async () => root.render(<Harness />));
    expect(text('Transform')).toBe(false); expect(text('Picture keys')).toBe(false); expect(text('Smart picture')).toBe(false);
    expect(text('Motion path and keyframes')).toBe(kind === 'text'); expect(text('Select a video clip.')).toBe(true);
    expect(text('Select a video clip or title.')).toBe(kind !== 'text');
});
test('only one point expands; Go pauses and seeks, while outside anchors stay editable but cannot seek', async () => {
    const original = tl.video[0].keyframes;
    tl.video[0].keyframes = [{ ...original![0], frame: -15 }, { ...original![1], frame: 45 }, { ...original![2], frame: 100 }];
    try {
        await act(async () => root.render(<Harness />));
        await press('Point 1 · -0.50 s');
        await press('Increase Point time · -0.50 s');
        expect((applyTimeline.mock.calls as unknown as [[typeof tl]])[0][0].video[0].keyframes![0].frame).toBe(-14);
        let go = root.container.queryAll(n => n.props.accessibilityLabel === 'Go to point' && n.props.accessibilityRole === 'button');
        expect(go[0].props.accessibilityState.disabled).toBe(true);
        await press('Point 2 · 1.50 s');
        expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Move to playhead' && typeof n.props.onClick === 'function')).toHaveLength(1);
        await press('Go to point'); expect(setPlaying).toHaveBeenCalledWith(false); expect(setFrame).toHaveBeenCalledWith(45);
        await press('Point 3 · 3.33 s');
        go = root.container.queryAll(n => n.props.accessibilityLabel === 'Go to point' && n.props.accessibilityRole === 'button');
        expect(go[0].props.accessibilityState.disabled).toBe(true);
    } finally { tl.video[0].keyframes = original; }
});

test('resetting already neutral S6 picture controls does not seed a key or commit', () => {
    const timeline = timelineOf(webSequenceV3()), clip = timeline.video[0]; clip.colourAdjustment = colourDefaults();
    clip.parameterKeyframes = [parameterKeyframe({ ...clip, parameterKeyframes: [] }, 0), parameterKeyframe({ ...clip, parameterKeyframes: [] }, 89)];
    frameStore.set(30); const before = JSON.stringify(timeline);
    const actions = useLookActions({ timeline, selection: { track: 'video', id: clip.id }, frameStore, applyTimeline, setProblem: jest.fn() });
    actions.resetColour(); actions.resetFilter(); expect(applyTimeline).not.toHaveBeenCalled(); expect(JSON.stringify(timeline)).toBe(before);
});


test.each(['colour', 'filter'] as const)('reset neutral evaluated %s also removes a non-neutral base before clearing picture keys', kind => {
    let timeline = timelineOf(webSequenceV3());
    const clip = timeline.video[0];
    clip.colourAdjustment = { ...colourDefaults(), exposure: 1 };
    clip.filter = { brightness: 2, contrast: 1, saturate: 1, hue: 0, blur: 0 };
    const neutral = { ...clip, filter: undefined, colourAdjustment: undefined, parameterKeyframes: [] };
    clip.parameterKeyframes = [parameterKeyframe(neutral, 0), parameterKeyframe(neutral, 89)];
    frameStore.set(30);
    const apply = jest.fn((next: typeof timeline) => { timeline = next; return true; });
    const props = () => ({ timeline, selection: { track: 'video' as const, id: clip.id }, frameStore, applyTimeline: apply, setProblem: jest.fn() });
    const look = useLookActions(props());
    expect(kind === 'colour' ? look.resetColour() : look.resetFilter()).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    const motion = useMotionActions({ ...props(), setFrame, setPlaying });
    expect(motion.clearPicture()).toBe(true);
    const values = evaluatedParameters(timeline.video[0], 30);
    expect(kind === 'colour' ? values.colour : values.filter).toEqual(kind === 'colour' ? colourDefaults() : FILTER_DEFAULTS);
});

test('Transform readouts before the clip use the web clamped expression with a negative anchor', async () => {
    const original = tl.video[0];
    tl.video[0] = { ...original, start: 10, keyframes: [
        { frame: -10, x: 0, y: 0, scale: 1, rotation: 0, opacity: .2, easing: 'linear' },
        { frame: 10, x: 1, y: 1, scale: 2, rotation: 90, opacity: 1, easing: 'linear' }] };
    frameStore.set(5);
    try {
        await act(async () => root.render(<Harness />));
        const web = evaluatedTransform(tl.video[0], Math.max(0, frameStore.get() - tl.video[0].start), false);
        const x = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === 'Position X')[0];
        expect(x.props.accessibilityValue.now).toBe(web.x * 100);
    } finally { tl.video[0] = original; }
});

test('motion, picture and mask easing groups identify their key number', async () => {
    await act(async () => root.render(<Harness />));
    const labels = () => root.container.queryAll(n => n.props.accessibilityRole === 'radiogroup').map(n => n.props.accessibilityLabel);
    expect(labels().filter(label => label === 'Easing, point 1')).toHaveLength(2);
    expect(labels().filter(label => label === 'Easing, point 2')).toHaveLength(2);
    await press('Point 1 · 0.00 s');
    expect(labels().filter(label => label === 'Easing, point 1')).toHaveLength(3);
    await press('Point 2 · 1.47 s');
    expect(labels().filter(label => label === 'Easing, point 2')).toHaveLength(3);
    expect(labels()).not.toContain('Easing');
});
