import { act } from 'react';
import { View, StyleSheet } from 'react-native';
import { createRoot } from 'test-renderer';
import { previewTransformStyle, fittedMediaStyle } from '../src/lib/editorMotionPreview';
import { EditorTransformLayer } from '../src/components/editor/EditorTransformLayer';
import { EditorMotionHandle } from '../src/components/editor/EditorMotionHandle';
import { useMotionActions } from '../src/components/editor/tools/useMotionActions';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import { emptyTimeline, type Clip, type Selection } from '../src/lib/nativeEditorModel';
import { evaluatedTransform, motionPreset } from '../../../app/veyrnox/_lib/editorAnimation.mjs';
const mockGestures: any[] = [];
jest.mock('react-native', () => {
    const actual = jest.requireActual('react-native');
    return Object.defineProperty(Object.create(actual), 'PanResponder', { value: {
        create: (config: unknown) => { mockGestures.push(config); return { panHandlers: {} }; },
    } });
});
void View;
const clip: Clip = { id: 'v1', start: 0, len: 90, mediaId: 'm', in: 0, volume: 1, transition: 0, trackId: 'video-0', fit: 'cover' };
test('identity, translation and flips follow the web matrix', () => {
    expect(previewTransformStyle(clip, 0, 200, 100)).toEqual({ opacity: 1,
        transform: [{ translateX: 0 }, { translateY: 0 }, { rotate: '0deg' }, { scaleX: 1 }, { scaleY: 1 }] });
    expect(previewTransformStyle({ ...clip, transform: { x: .75, scale: 2, flipX: true, flipY: true } }, 0, 200, 100)).toEqual({ opacity: 1,
        transform: [{ translateX: 50 }, { translateY: 0 }, { rotate: '0deg' }, { scaleX: -2 }, { scaleY: -2 }] });
});
test.each([0, 45, 89])('keys at %s ignore in/out animations', offset => {
    const c = { ...clip, animation: { in: 'fade', duration: 15 }, keyframes: motionPreset(clip, 'arc') };
    const v = evaluatedTransform(c, offset, false);
    expect(previewTransformStyle(c, offset, 200, 100)).toEqual({ opacity: v.opacity, transform: [
        { translateX: (v.x - .5) * 200 }, { translateY: (v.y - .5) * 100 }, { rotate: `${v.rotation}deg` }, { scaleX: v.scale }, { scaleY: v.scale }] });
});
test.each([{ x: .75 }, { rotation: 45 }, { scale: 1.5 }])('Cover transforms the full fitted picture %j', async transform => {
    const root = createRoot(), store = createFrameStore(), c = { ...clip, transform };
    const media = { id: 'm', width: 400, height: 200 };
    await act(async () => root.render(<EditorTransformLayer clip={c} media={media} frameStore={store}><View /></EditorTransformLayer>));
    const outer = root.container.queryAll(n => n.props.testID === 'editor-transform-layout')[0];
    await act(async () => outer.props.onLayout({ nativeEvent: { layout: { width: 200, height: 200 } } }));
    const inner = root.container.queryAll(n => n.props.testID === 'editor-transform-picture')[0];
    const style = StyleSheet.flatten(inner.props.style);
    expect(style).toMatchObject({ width: 400, height: 200, left: -100, top: 0, ...previewTransformStyle(c, 0, 200, 200) });
    if ('x' in transform) { expect(style.left + 50).toBeLessThanOrEqual(0); expect(style.left + 50 + style.width).toBeGreaterThanOrEqual(200); }
    await act(async () => root.unmount());
});
test('portrait contain and cover use fitted dimensions before rotation', () => {
    expect(fittedMediaStyle({ ...clip, fit: 'contain' }, { id: 'm', width: 100, height: 200 }, 200, 200)).toEqual({ width: 100, height: 200, left: 50, top: 0 });
    expect(fittedMediaStyle(clip, { id: 'm', width: 100, height: 200 }, 200, 200)).toEqual({ width: 200, height: 400, left: 0, top: -100 });
});
test('handle visibility follows the rendered clip, and drag/action commits use shared patch exactly once', async () => {
    const root = createRoot(), frameStore = createFrameStore(), tl = emptyTimeline();
    tl.media.m = { id: 'm', kind: 'image', name: 'Image', frames: 90, hasAudio: false, width: 200, height: 100 }; tl.video = [{ ...clip, keyframes: motionPreset(clip, 'arc') }];
    const applyTimeline = jest.fn(() => true), setProblem = jest.fn(); let selection: Selection = { track: 'video', id: clip.id };
    function Harness() {
        const actions = useMotionActions({ timeline: tl, selection, frameStore, applyTimeline, setProblem, setFrame: frameStore.set, setPlaying: jest.fn() });
        return <EditorMotionHandle timeline={tl} selection={selection} actions={actions} />;
    }
    await act(async () => root.render(<Harness />));
    const layout = () => root.container.queryAll(n => n.props.testID === 'editor-motion-layout')[0];
    await act(async () => layout().props.onLayout({ nativeEvent: { layout: { width: 200, height: 100 } } }));
    const gesture = mockGestures.at(-1);
    await act(async () => { gesture.onPanResponderGrant(); gesture.onPanResponderMove(null, { dx: 400, dy: -400 }); });
    expect(applyTimeline).not.toHaveBeenCalled();
    await act(async () => gesture.onPanResponderRelease());
    expect(applyTimeline).toHaveBeenCalledTimes(1);
    const committed = (applyTimeline.mock.calls as unknown as [[typeof tl]])[0][0].video[0];
    expect(committed.transform).toMatchObject({ x: 1, y: 0 }); expect(committed.keyframes![0]).toMatchObject({ frame: 0, x: 1, y: 0, easing: 'linear' });
    for (const [name, x, y] of [['left', .34, .5], ['right', .36, .5], ['up', .35, .49], ['down', .35, .51]] as const) {
        applyTimeline.mockClear();
        const handle = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')[0];
        await act(async () => handle.props.onAccessibilityAction({ nativeEvent: { actionName: name } }));
        expect(applyTimeline).toHaveBeenCalledTimes(1);
        expect((applyTimeline.mock.calls as unknown as [[typeof tl]])[0][0].video[0].transform).toMatchObject({ x, y });
    }
    for (const track of ['audio', 'text'] as const) {
        selection = { track, id: clip.id }; await act(async () => root.render(<Harness />));
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')).toHaveLength(0);
    }
    selection = { track: 'video', id: clip.id };
    for (const state of ['locked', 'hidden', 'overlap', 'outside'] as const) {
        tl.tracks[0].locked = state === 'locked'; tl.tracks[0].hidden = state === 'hidden';
        tl.video = state === 'overlap' ? [{ ...clip }, { ...clip, id: 'v2' }] : [{ ...clip }];
        frameStore.set(state === 'outside' ? 90 : 0);
        await act(async () => root.render(<Harness />));
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')).toHaveLength(0);
    }
    await act(async () => root.unmount());
});

const mockVideo = { loop: false, keepScreenOnWhilePlaying: false, timeUpdateEventInterval: 0, currentTime: 0, playbackRate: 1, volume: 1,
    play: jest.fn(), pause: jest.fn(), addListener: jest.fn((_name: string, _callback: (event: any) => void) => ({ remove: jest.fn() })) };
jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement(require('react-native').View, { ...props, testID: 'decoded-image' }) }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockVideo,
    VideoView: (props: any) => require('react').createElement(require('react-native').View, { ...props, testID: 'decoded-video' }) }));
import { EditorMediaPreview } from '../src/components/editor/EditorMediaPreview';
test.each(['image', 'video'])('decoded %s dimensions fix Cover fitting when catalog dimensions are unknown', async kind => {
    const root = createRoot(), frameStore = createFrameStore(), c = { ...clip, transform: { x: .75 } };
    mockVideo.addListener.mockClear();
    await act(async () => root.render(<EditorMediaPreview api={{ request: jest.fn() }} clip={c}
        media={{ id: 'm', kind, width: 0, height: 0 }} frameStore={frameStore} fps={30} playing={false} localUri="file://media" />));
    const outer = root.container.queryAll(n => n.props.testID === 'editor-transform-layout')[0];
    await act(async () => outer.props.onLayout({ nativeEvent: { layout: { width: 200, height: 200 } } }));
    await act(async () => {
        if (kind === 'image') root.container.queryAll(n => n.props.testID === 'decoded-image')[0].props.onLoad({ source: { width: 400, height: 200 } });
        else mockVideo.addListener.mock.calls.find(([name]) => name === 'sourceLoad')![1]({ availableVideoTracks: [{ size: { width: 400, height: 200 } }] });
    });
    expect(StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'editor-transform-picture')[0].props.style)).toMatchObject({ width: 400, height: 200, left: -100 });
    await act(async () => root.unmount());
});
