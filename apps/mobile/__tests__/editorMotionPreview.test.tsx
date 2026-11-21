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
        expect(handle.props.accessible).toBe(true);
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

const mockVideo = { status: 'readyToPlay', videoTrack: { size: { width: 1920, height: 1080 } },
    generateThumbnailsAsync: jest.fn(async () => [] as { width: number; height: number; release: () => void }[]),
    loop: false, keepScreenOnWhilePlaying: false, timeUpdateEventInterval: 0, currentTime: 0, playbackRate: 1, volume: 1,
    play: jest.fn(), pause: jest.fn(), addListener: jest.fn((_name: string, _callback: (event: any) => void) => ({ remove: jest.fn() })) };
jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement(require('react-native').View, { ...props, testID: 'decoded-image' }) }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockVideo,
    VideoView: (props: any) => require('react').createElement(require('react-native').View, { ...props, testID: 'decoded-video' }) }));
import { EditorMediaPreview } from '../src/components/editor/EditorMediaPreview';
beforeEach(() => { mockVideo.generateThumbnailsAsync.mockReset().mockResolvedValue([]); mockVideo.addListener.mockClear(); mockVideo.status = 'readyToPlay'; });
test('decoded image dimensions fix Cover fitting when catalog dimensions are unknown', async () => {
    const kind = 'image';
    const root = createRoot(), frameStore = createFrameStore(), c = { ...clip, transform: { x: .75 } };
    mockVideo.addListener.mockClear();
    await act(async () => root.render(<EditorMediaPreview api={{ request: jest.fn() }} clip={c}
        media={{ id: 'm', kind, width: 0, height: 0 }} frameStore={frameStore} fps={30} playing={false} localUri="file://media" />));
    const outer = root.container.queryAll(n => n.props.testID === 'editor-transform-layout')[0];
    await act(async () => outer.props.onLayout({ nativeEvent: { layout: { width: 200, height: 200 } } }));
    await act(async () => {
        root.container.queryAll(n => n.props.testID === 'decoded-image')[0].props.onLoad({ source: { width: 400, height: 200 } });
    });
    expect(StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'editor-transform-picture')[0].props.style)).toMatchObject({ width: 400, height: 200, left: -100 });
    await act(async () => root.unmount());
});


test.each(['cover', 'contain'] as const)('portrait video uses decoded display dimensions under %s, never the unrotated track size', async fit => {
    const root = createRoot(), frameStore = createFrameStore(), release = jest.fn();
    mockVideo.addListener.mockClear();
    let decode!: (sizes: { width: number; height: number; release: () => void }[]) => void;
    mockVideo.generateThumbnailsAsync.mockImplementationOnce(() => new Promise(resolve => { decode = resolve; }));
    await act(async () => root.render(<EditorMediaPreview api={{ request: jest.fn() }} clip={{ ...clip, fit }}
        media={{ id: 'm', kind: 'video', width: 1920, height: 1080 }} frameStore={frameStore} fps={30} playing={false} localUri="file://portrait" />));
    const outer = root.container.queryAll(n => n.props.testID === 'editor-transform-layout')[0];
    await act(async () => outer.props.onLayout({ nativeEvent: { layout: { width: 200, height: 200 } } }));
    const picture = () => StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'editor-transform-picture')[0].props.style);
    const video = () => root.container.queryAll(n => n.props.testID === 'decoded-video')[0];
    expect(picture()).toMatchObject({ width: 200, height: 200, left: 0, top: 0 });
    expect(video().props.contentFit).toBe(fit);
    expect(video().props.surfaceType).toBe('textureView');
    await act(async () => {
        for (const [name, callback] of mockVideo.addListener.mock.calls) {
            if (name === 'sourceLoad') callback({ availableVideoTracks: [mockVideo.videoTrack] });
            if (name === 'videoTrackChange') callback({ videoTrack: mockVideo.videoTrack });
        }
    });
    expect(picture()).toMatchObject({ width: 200, height: 200 });
    await act(async () => decode([{ width: 108, height: 192, release }]));
    const expected = fit === 'cover' ? { width: 200, height: 200 * 192 / 108, left: 0, top: (200 - 200 * 192 / 108) / 2 }
        : { width: 112.5, height: 200, left: 43.75, top: 0 };
    for (const field of ['width', 'height', 'left', 'top'] as const) expect(picture()[field]).toBeCloseTo(expected[field]);
    expect(video().props.contentFit).toBe('contain');
    expect(release).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
});

test('readyToPlay decodes dimensions once after mounting while loading without sourceLoad', async () => {
    const root = createRoot(), release = jest.fn(); mockVideo.status = 'loading';
    mockVideo.generateThumbnailsAsync.mockResolvedValueOnce([{ width: 108, height: 192, release }]);
    try {
        await act(async () => root.render(<EditorMediaPreview api={{ request: jest.fn() }} clip={{ ...clip, fit: 'contain' }}
            media={{ id: 'm', kind: 'video' }} frameStore={createFrameStore()} fps={30} playing={false} localUri="file://loading" />));
        const outer = root.container.queryAll(n => n.props.testID === 'editor-transform-layout')[0];
        await act(async () => outer.props.onLayout({ nativeEvent: { layout: { width: 200, height: 200 } } }));
        const picture = () => StyleSheet.flatten(root.container.queryAll(n => n.props.testID === 'editor-transform-picture')[0].props.style);
        const status = (value: string) => {
            mockVideo.status = value;
            for (const [name, callback] of mockVideo.addListener.mock.calls) if (name === 'statusChange') callback({ status: value });
        };
        await act(async () => status('loading'));
        expect(mockVideo.generateThumbnailsAsync).not.toHaveBeenCalled();
        expect(picture()).toMatchObject({ width: 200, height: 200 });
        await act(async () => { status('readyToPlay'); status('readyToPlay'); });
        expect(mockVideo.generateThumbnailsAsync).toHaveBeenCalledTimes(1);
        expect(mockVideo.generateThumbnailsAsync).toHaveBeenCalledWith(0, { maxWidth: 384, maxHeight: 384 });
        const expected = { width: 112.5, height: 200, left: 43.75, top: 0 };
        for (const field of ['width', 'height', 'left', 'top'] as const) expect(picture()[field]).toBeCloseTo(expected[field]);
        expect(release).toHaveBeenCalledTimes(1);
        await act(async () => status('readyToPlay'));
        expect(mockVideo.generateThumbnailsAsync).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); }
    for (const subscription of mockVideo.addListener.mock.results) expect(subscription.value.remove).toHaveBeenCalledTimes(1);
});

test.each(['cover', 'contain'] as const)('unknown video dimensions preserve native %s when thumbnail decoding fails', async fit => {
    const root = createRoot(); mockVideo.generateThumbnailsAsync.mockRejectedValueOnce(new Error('No thumbnail'));
    await act(async () => root.render(<EditorMediaPreview api={{ request: jest.fn() }} clip={{ ...clip, fit }}
        media={{ id: 'm', kind: 'video' }} frameStore={createFrameStore()} fps={30} playing={false} localUri="file://unknown" />));
    expect(root.container.queryAll(n => n.props.testID === 'decoded-video')[0].props.contentFit).toBe(fit);
    await act(async () => root.unmount());
});

test('video error is outside the invisible flipped picture and clears on recovery or source change', async () => {
    const root = createRoot(), frameStore = createFrameStore(); mockVideo.addListener.mockClear();
    const render = (uri: string) => root.render(<EditorMediaPreview api={{ request: jest.fn() }}
        clip={{ ...clip, transform: { opacity: 0, flipX: true } }} media={{ id: 'm', kind: 'video' }}
        frameStore={frameStore} fps={30} playing={false} localUri={uri} />);
    await act(async () => render('file://broken'));
    const status = (event: { status: string }) => {
        for (const [name, callback] of mockVideo.addListener.mock.calls) if (name === 'statusChange') callback(event);
    };
    const unavailable = () => root.container.queryAll(n => n.children.includes('Preview unavailable'));
    await act(async () => status({ status: 'error' }));
    expect(unavailable()).toHaveLength(1);
    const picture = root.container.queryAll(n => n.props.testID === 'editor-transform-picture')[0];
    expect(StyleSheet.flatten(picture.props.style)).toMatchObject({ opacity: 0 });
    expect(picture.queryAll(n => n.children.includes('Preview unavailable'))).toHaveLength(0);
    await act(async () => status({ status: 'readyToPlay' })); expect(unavailable()).toHaveLength(0);
    await act(async () => status({ status: 'error' })); expect(unavailable()).toHaveLength(1);
    await act(async () => render('file://replacement')); expect(unavailable()).toHaveLength(0);
    await act(async () => root.unmount());
});


test('video always uses a texture surface', async () => {
    const root = createRoot();
    await act(async () => root.render(<EditorMediaPreview api={{ request: jest.fn() }} clip={clip}
        media={{ id: 'm', kind: 'video' }} frameStore={createFrameStore()} fps={30} playing={false} localUri="file://surface" />));
    expect(root.container.queryAll(n => n.props.testID === 'decoded-video')[0].props.surfaceType).toBe('textureView');
    await act(async () => root.unmount());
});


test('a late thumbnail from the previous source is released without changing the replacement fit', async () => {
    const root = createRoot(), frameStore = createFrameStore(), release = jest.fn();
    let decode!: (sizes: { width: number; height: number; release: () => void }[]) => void;
    mockVideo.generateThumbnailsAsync.mockImplementationOnce(() => new Promise(resolve => { decode = resolve; }));
    const render = (uri: string) => root.render(<EditorMediaPreview api={{ request: jest.fn() }} clip={clip}
        media={{ id: 'm', kind: 'video' }} frameStore={frameStore} fps={30} playing={false} localUri={uri} />);
    await act(async () => render('file://old'));
    await act(async () => render('file://new'));
    await act(async () => decode([{ width: 108, height: 192, release }]));
    expect(root.container.queryAll(n => n.props.testID === 'decoded-video')[0].props.contentFit).toBe('cover');
    expect(release).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
});
