import { act } from 'react';
import { PixelRatio } from 'react-native';
import { createRoot } from 'test-renderer';
import { editorPreviewAccessibilityLabel, PlaybackPreview } from '../src/components/editor/EditorPlayback';
import { EditorStaticPreviewSurface } from '../src/components/editor/EditorStaticPreviewSurface';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import { editorPreviewPlan } from '../src/lib/editorPreviewPlan';
import { emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';

const mockLoader = { load: jest.fn(), cancel: jest.fn(), dispose: jest.fn() };
const mockBind = jest.fn((..._args: unknown[]) => ({ width: 320, height: 180, background: '#000000', layers: [] }));
const mockRender = jest.fn((..._args: unknown[]): unknown => undefined);
const mockSourceKey = jest.fn((..._args: unknown[]) => 'source-key');
const mockCapabilities = [
    'timeline-background', 'image-source', 'graphic-source', 'fit', 'crop', 'transform', 'visual-layering', 'blend', 'mask', 'clip-animation',
    'clip-background-solid', 'clip-background-blur', 'clip-background-image',
];
jest.mock('../src/lib/editorStaticPreviewSources', () => ({
    createEditorStaticPreviewSourceLoader: () => mockLoader,
    editorStaticPreviewSourceKey: (...args: unknown[]) => mockSourceKey(...args),
}));
jest.mock('../src/lib/editorRender', () => ({
    SKIA_STATIC_PREVIEW_CAPABILITIES: mockCapabilities,
    STATIC_PREVIEW_LIMITS: { maxWidth: 1280, maxHeight: 1280, maxPixels: 1280 * 720, maxLayers: 40 },
    bindStaticPreviewPlan: (...args: unknown[]) => mockBind(...args),
    renderStaticPreviewImage: (...args: unknown[]) => mockRender(...args),
}));
jest.mock('@shopify/react-native-skia', () => ({
    Skia: { native: true },
    Canvas: (props: any) => require('react').createElement(require('react-native').View, { ...props, testID: props.testID || 'mock-skia-canvas' }),
    Image: (props: any) => require('react').createElement(require('react-native').View, { ...props, testID: 'mock-skia-image' }),
}));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({
    EditorMediaPreview: () => require('react').createElement(require('react-native').View,
        { testID: 'legacy-editor-preview', accessibilityLabel: 'Legacy preview' }),
}));

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(next => { resolve = next; });
    return { promise, resolve };
};
const timeline = (): Timeline => {
    const value = emptyTimeline();
    value.media.image = { id: 'image', kind: 'image', frames: 90, width: 640, height: 360, hasAudio: false };
    value.video = [{ id: 'v1', mediaId: 'image', start: 0, in: 0, len: 90, trackId: 'video-0',
        crop: { x: .1, y: 0, width: .9, height: 1 } }];
    return value;
};

beforeEach(() => {
    jest.clearAllMocks(); mockLoader.load.mockReset(); mockRender.mockReset();
    mockBind.mockReset().mockImplementation((..._args: unknown[]) => ({ width: 320, height: 180, background: '#000000', layers: [] }));
    mockSourceKey.mockReset().mockReturnValue('source-key');
    mockCapabilities.splice(0, mockCapabilities.length,
        'timeline-background', 'image-source', 'graphic-source', 'fit', 'crop', 'transform', 'visual-layering', 'blend', 'mask', 'clip-animation',
        'clip-background-solid', 'clip-background-blur', 'clip-background-image');
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

test('keeps legacy visible until a current paused frame commits, then atomically returns on play', async () => {
    const pending = deferred<any>(), next = deferred<any>(), sourceDispose = jest.fn(), outputDispose = jest.fn();
    mockLoader.load.mockReturnValueOnce(pending.promise).mockReturnValueOnce(next.promise);
    mockRender.mockReturnValueOnce({ ok: true, width: 320, height: 180, image: { dispose: outputDispose } });
    const root = createRoot(), frameStore = createFrameStore(5), value = timeline();
    const render = (playing: boolean) => root.render(<PlaybackPreview staticPreview frameStore={frameStore} timeline={value}
        api={{ request: jest.fn() }} playing={playing} localMediaUris={{ image: 'file://image.png' }} />);
    try {
        await act(async () => render(false));
        expect(root.container.queryAll(node => node.props.testID === 'legacy-editor-preview')).toHaveLength(1);
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(0);
        expect(root.container.queryAll(node => node.children.includes('Approximate preview'))).toHaveLength(1);
        expect(root.container.queryAll(node => node.props.accessibilityRole === 'image')).toHaveLength(0);
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        expect(surface.props).toMatchObject({ pointerEvents: 'none', accessible: false, accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' });
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        expect(mockLoader.load).toHaveBeenCalledTimes(1);
        await act(async () => pending.resolve({ status: 'ready', sources: { images: { image: {} }, key: 'source-key', dispose: sourceDispose } }));
        expect(sourceDispose).not.toHaveBeenCalled();
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(1);
        expect(root.container.queryAll(node => node.props.accessibilityRole === 'image')).toHaveLength(1);
        expect(root.container.queryAll(node => node.props.importantForAccessibility === 'no-hide-descendants')).toHaveLength(2);
        expect(root.container.queryAll(node => node.children.includes('Approximate preview'))).toHaveLength(0);
        await act(async () => render(true));
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(0);
        expect(root.container.queryAll(node => node.props.testID === 'legacy-editor-preview')).toHaveLength(1);
        expect(root.container.queryAll(node => node.children.includes('Approximate preview'))).toHaveLength(1);
        expect(sourceDispose).toHaveBeenCalledTimes(1);
        expect(outputDispose).toHaveBeenCalledTimes(1);
        await act(async () => render(false));
        expect(mockLoader.load).toHaveBeenCalledTimes(2);
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(0);
        expect(root.container.queryAll(node => node.props.testID === 'legacy-editor-preview')).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
});

test('keeps the static picture approximate when its external audio mix is not rendered', async () => {
    const sourceDispose = jest.fn(), outputDispose = jest.fn();
    mockLoader.load.mockResolvedValueOnce({ status: 'ready', sources: { images: { image: {} }, key: 'source-key', dispose: sourceDispose } });
    mockRender.mockReturnValueOnce({ ok: true, width: 320, height: 180, image: { dispose: outputDispose } });
    const root = createRoot(), value = timeline();
    value.media.sound = { id: 'sound', kind: 'audio', frames: 90, hasAudio: true };
    value.audio = [{ id: 'a1', mediaId: 'sound', start: 0, in: 0, len: 90, trackId: 'audio-0' }];
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={createFrameStore(5)} timeline={value}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{ image: 'file://image.png' }} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(1);
        expect(root.container.queryAll(node => node.children.includes('Approximate preview'))).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
    expect(sourceDispose).toHaveBeenCalledTimes(1); expect(outputDispose).toHaveBeenCalledTimes(1);
});

test('unsupported and opt-out paths never load or hide the legacy preview', async () => {
    const root = createRoot(), value = timeline(), frameStore = createFrameStore(5);
    value.text = [{ id: 't1', text: 'Title', start: 0, len: 30, x: .5, y: .5, size: 6, trackId: 'text-0' }];
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={frameStore} timeline={value}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{ image: 'file://image.png' }} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        expect(mockLoader.load).not.toHaveBeenCalled();
        expect(root.container.queryAll(node => node.props.testID === 'legacy-editor-preview')).toHaveLength(1);
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(0);
        await act(async () => root.render(<PlaybackPreview frameStore={frameStore} timeline={timeline()}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{ image: 'file://image.png' }} />));
        expect(root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')).toHaveLength(0);
    } finally { await act(async () => root.unmount()); }
});

test.each([
    ['source refusal', () => Promise.resolve({ status: 'unsupported', issues: [] }), undefined],
    ['decode rejection', () => Promise.reject(new Error('decode failed')), undefined],
    ['render refusal', () => Promise.resolve({ status: 'ready', sources: { images: { image: {} }, key: 'source-key', dispose: jest.fn() } }),
        { ok: false, code: 'unsupported', features: ['filter'] }],
])('%s keeps the legacy frame visible', async (_name, load, renderResult) => {
    mockLoader.load.mockImplementationOnce(load as any);
    if (renderResult) mockRender.mockReturnValueOnce(renderResult);
    const root = createRoot();
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={createFrameStore(5)} timeline={timeline()}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{ image: 'file://image.png' }} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        expect(root.container.queryAll(node => node.props.testID === 'legacy-editor-preview')).toHaveLength(1);
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(0);
    } finally { await act(async () => root.unmount()); }
});

test('disposes a stale decoded generation without rendering or mounting it', async () => {
    const pending = deferred<any>(), next = deferred<any>(), staleDispose = jest.fn();
    mockLoader.load.mockReturnValueOnce(pending.promise).mockReturnValueOnce(next.promise);
    const root = createRoot(), frameStore = createFrameStore(5), api = { request: jest.fn() }, uris = { image: 'file://image.png' };
    const initial = timeline(), moved = { ...initial, video: [{ ...initial.video[0], transform: { x: .7, y: .5 } }] };
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={frameStore} timeline={initial}
            api={api} playing={false} localMediaUris={uris} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={frameStore} timeline={moved}
            api={api} playing={false} localMediaUris={uris} />));
        await act(async () => pending.resolve({ status: 'ready', sources: { images: { image: {} }, key: 'stale', dispose: staleDispose } }));
        expect(staleDispose).toHaveBeenCalledTimes(1);
        expect(mockRender).not.toHaveBeenCalled();
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(0);
        expect(root.container.queryAll(node => node.props.testID === 'legacy-editor-preview')).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
});

test.each([
    ['video', (value: Timeline) => { value.media.image.kind = 'video'; }],
    ['graphic', (value: Timeline) => { value.media.image.kind = 'graphic'; }],
    ['transition', (value: Timeline) => {
        value.media.next = { id: 'next', kind: 'image', frames: 90, width: 640, height: 360, hasAudio: false };
        value.video[0] = { ...value.video[0], start: 0, len: 20 };
        value.video.push({ id: 'v2', mediaId: 'next', start: 20, in: 0, len: 30, trackId: 'video-0', transition: 10 });
    }],
])('%s frames stay on legacy without starting a static source load', async (_name, mutate) => {
    const value = timeline(); mutate(value);
    const root = createRoot(), frame = _name === 'transition' ? 20 : 5;
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={createFrameStore(frame)} timeline={value}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{ image: 'file://image.png', next: 'file://next.png' }} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        expect(mockLoader.load).not.toHaveBeenCalled();
        expect(root.container.queryAll(node => node.props.testID === 'legacy-editor-preview')).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
});

test('binds overlapping image layers in canonical track order', async () => {
    const value = timeline(), sourceDispose = jest.fn(), outputDispose = jest.fn();
    value.media.low = { id: 'low', kind: 'image', frames: 90, width: 640, height: 360, hasAudio: false };
    value.media.high = { id: 'high', kind: 'image', frames: 90, width: 640, height: 360, hasAudio: false };
    value.tracks = [
        { id: 'video-1', kind: 'video', name: 'Low', locked: false, muted: false, hidden: false },
        { id: 'video-0', kind: 'video', name: 'High', locked: false, muted: false, hidden: false },
        ...value.tracks.filter(track => track.kind !== 'video'),
    ];
    value.video = [
        { id: 'high-clip', mediaId: 'high', start: 0, in: 0, len: 90, trackId: 'video-0', transition: 0 },
        { id: 'low-clip', mediaId: 'low', start: 0, in: 0, len: 90, trackId: 'video-1', transition: 0 },
    ];
    mockLoader.load.mockResolvedValueOnce({ status: 'ready', sources: { images: { low: {}, high: {} }, key: 'source-key', dispose: sourceDispose } });
    mockRender.mockReturnValueOnce({ ok: true, width: 320, height: 180, image: { dispose: outputDispose } });
    const root = createRoot();
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={createFrameStore(5)} timeline={value}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{ low: 'file://low.png', high: 'file://high.png' }} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        const boundPlan = mockBind.mock.calls[0]?.[0] as any;
        expect(boundPlan.visuals.map((layer: any) => layer.clip.id)).toEqual(['low-clip', 'high-clip']);
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
    expect(sourceDispose).toHaveBeenCalledTimes(1); expect(outputDispose).toHaveBeenCalledTimes(1);
});

test('uses the lazy renderer capability table instead of the generic static defaults', async () => {
    mockCapabilities.splice(mockCapabilities.indexOf('crop'), 1);
    const root = createRoot();
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={createFrameStore(5)} timeline={timeline()}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{ image: 'file://image.png' }} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        expect(mockLoader.load).not.toHaveBeenCalled();
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(0);
    } finally { await act(async () => root.unmount()); }
});

test('reuses decoded sources for a transform change and swaps output images after commit', async () => {
    const sourceDispose = jest.fn(), firstDispose = jest.fn(), secondDispose = jest.fn();
    const firstImage = { id: 'first', dispose: firstDispose }, secondImage = { id: 'second', dispose: secondDispose };
    mockLoader.load.mockResolvedValueOnce({ status: 'ready', sources: { images: { image: {} }, key: 'source-key', dispose: sourceDispose } });
    mockRender.mockReturnValueOnce({ ok: true, width: 640, height: 360, image: firstImage })
        .mockReturnValueOnce({ ok: true, width: 640, height: 360, image: secondImage });
    const root = createRoot(), frameStore = createFrameStore(5), api = { request: jest.fn() }, uris = { image: 'file://image.png' };
    const initial = timeline(), moved = { ...initial, video: [{ ...initial.video[0], transform: { x: .7, y: .5 } }] };
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={frameStore} timeline={initial}
            api={api} playing={false} localMediaUris={uris} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')[0].props.image).toBe(firstImage);
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={frameStore} timeline={moved}
            api={api} playing={false} localMediaUris={uris} />));
        expect(mockLoader.load).toHaveBeenCalledTimes(1);
        expect(mockRender).toHaveBeenCalledTimes(2);
        expect(sourceDispose).not.toHaveBeenCalled();
        expect(firstDispose).toHaveBeenCalledTimes(1);
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')[0].props.image).toBe(secondImage);
    } finally { await act(async () => root.unmount()); }
    expect(sourceDispose).toHaveBeenCalledTimes(1); expect(secondDispose).toHaveBeenCalledTimes(1);
});

test('reveals the correct legacy preview during a cross-source decode and disposes both caches exactly once', async () => {
    mockSourceKey.mockImplementation((plan: any) => plan.visuals.map((layer: any) => layer.clip.mediaId).join(','));
    const pending = deferred<any>(), firstSourceDispose = jest.fn(), secondSourceDispose = jest.fn();
    const firstDispose = jest.fn(), secondDispose = jest.fn(), firstImage = { id: 'first', dispose: firstDispose }, secondImage = { id: 'second', dispose: secondDispose };
    mockLoader.load.mockResolvedValueOnce({ status: 'ready', sources: { images: { image: {} }, key: 'image', dispose: firstSourceDispose } })
        .mockReturnValueOnce(pending.promise);
    mockRender.mockReturnValueOnce({ ok: true, width: 640, height: 360, image: firstImage })
        .mockReturnValueOnce({ ok: true, width: 640, height: 360, image: secondImage });
    const root = createRoot(), frameStore = createFrameStore(5), api = { request: jest.fn() };
    const initial = timeline(), replacement = timeline();
    replacement.media = { next: { id: 'next', name: 'Next', kind: 'image', frames: 90, width: 640, height: 360, hasAudio: false } };
    replacement.video = [{ ...replacement.video[0], mediaId: 'next' }];
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={frameStore} timeline={initial}
            api={api} playing={false} localMediaUris={{ image: 'file://image.png' }} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={frameStore} timeline={replacement}
            api={api} playing={false} localMediaUris={{ next: 'file://next.png' }} />));
        expect(firstSourceDispose).toHaveBeenCalledTimes(1);
        expect(firstDispose).toHaveBeenCalledTimes(1);
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')).toHaveLength(0);
        expect(root.container.queryAll(node => node.props.testID === 'legacy-editor-preview')).toHaveLength(1);
        expect(root.container.queryAll(node => node.props.accessibilityRole === 'image')).toHaveLength(0);
        expect(root.container.queryAll(node => node.props.importantForAccessibility === 'auto')).toHaveLength(1);
        expect(root.container.queryAll(node => node.children.includes('Approximate preview'))).toHaveLength(1);
        await act(async () => pending.resolve({ status: 'ready', sources: { images: { next: {} }, key: 'next', dispose: secondSourceDispose } }));
        expect(firstDispose).toHaveBeenCalledTimes(1);
        expect(secondSourceDispose).not.toHaveBeenCalled();
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')[0].props.image).toBe(secondImage);
    } finally { await act(async () => root.unmount()); }
    expect(secondSourceDispose).toHaveBeenCalledTimes(1); expect(secondDispose).toHaveBeenCalledTimes(1);
});

test('preserves exactness across the intermediate commit of a same-source frame and transform update', async () => {
    const sourceDispose = jest.fn(), firstDispose = jest.fn(), secondDispose = jest.fn(), displays: any[] = [];
    mockLoader.load.mockResolvedValueOnce({ status: 'ready', sources: { images: { image: {} }, key: 'source-key', dispose: sourceDispose } });
    mockRender.mockReturnValueOnce({ ok: true, width: 640, height: 360, image: { dispose: firstDispose } })
        .mockReturnValueOnce({ ok: true, width: 640, height: 360, image: { dispose: secondDispose } });
    const root = createRoot(), api = { request: jest.fn() }, uris = { image: 'file://image.png' }, initial = timeline();
    const moved = { ...initial, video: [{ ...initial.video[0], transform: { x: .65, y: .5 } }] };
    const render = (value: Timeline, frame: number) => root.render(<EditorStaticPreviewSurface enabled timeline={value} frame={frame}
        api={api} localMediaUris={uris} onDisplayed={display => displays.push(display)} />);
    try {
        await act(async () => render(initial, 5));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        const committedAt = displays.length;
        await act(async () => render(moved, 6));
        expect(displays.slice(committedAt)).not.toContainEqual(null);
        expect(displays.slice(committedAt).every(display => display?.exact === true)).toBe(true);
        expect(mockLoader.load).toHaveBeenCalledTimes(1);
        expect(mockRender).toHaveBeenCalledTimes(2);
    } finally { await act(async () => root.unmount()); }
    expect(sourceDispose).toHaveBeenCalledTimes(1); expect(firstDispose).toHaveBeenCalledTimes(1); expect(secondDispose).toHaveBeenCalledTimes(1);
});

test('reuses a frame-invariant still output but rerenders an animated visual on frame steps', async () => {
    const sourceDispose = jest.fn(), disposed: jest.Mock[] = [];
    mockLoader.load.mockResolvedValueOnce({ status: 'ready', sources: { images: { image: {} }, key: 'source-key', dispose: sourceDispose } });
    mockRender.mockImplementation(() => {
        const dispose = jest.fn(); disposed.push(dispose);
        return { ok: true, width: 640, height: 360, image: { dispose } };
    });
    const root = createRoot(), frameStore = createFrameStore(5), api = { request: jest.fn() }, uris = { image: 'file://image.png' };
    const still = timeline(), animated = { ...still, video: [{ ...still.video[0], animation: { in: 'fade', duration: 15 } }] };
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={frameStore} timeline={still}
            api={api} playing={false} localMediaUris={uris} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        await act(async () => frameStore.set(6));
        await act(async () => frameStore.set(7));
        expect(mockLoader.load).toHaveBeenCalledTimes(1);
        expect(mockRender).toHaveBeenCalledTimes(1);
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={frameStore} timeline={animated}
            api={api} playing={false} localMediaUris={uris} />));
        await act(async () => frameStore.set(8));
        expect(mockLoader.load).toHaveBeenCalledTimes(1);
        expect(mockRender).toHaveBeenCalledTimes(3);
    } finally { await act(async () => root.unmount()); }
    expect(sourceDispose).toHaveBeenCalledTimes(1); disposed.forEach(dispose => expect(dispose).toHaveBeenCalledTimes(1));
});

test('renders at bounded device pixels while drawing the image at layout size', async () => {
    const ratio = jest.spyOn(PixelRatio, 'get').mockReturnValue(3), sourceDispose = jest.fn(), outputDispose = jest.fn();
    mockLoader.load.mockResolvedValueOnce({ status: 'ready', sources: { images: { image: {} }, key: 'source-key', dispose: sourceDispose } });
    mockRender.mockReturnValueOnce({ ok: true, width: 1108, height: 831, image: { dispose: outputDispose } });
    const root = createRoot();
    try {
        await act(async () => root.render(<PlaybackPreview staticPreview frameStore={createFrameStore(5)} timeline={timeline()}
            api={{ request: jest.fn() }} playing={false} localMediaUris={{ image: 'file://image.png' }} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-static-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 800, height: 600 } } }));
        const renderCall = mockBind.mock.calls[0] as unknown as [unknown, number, number];
        const renderWidth = renderCall[1], renderHeight = renderCall[2];
        expect(renderWidth).toBeLessThanOrEqual(1280); expect(renderHeight).toBeLessThanOrEqual(1280);
        expect(renderWidth * renderHeight).toBeLessThanOrEqual(1280 * 720);
        expect(renderWidth / renderHeight).toBeCloseTo(4 / 3, 2);
        expect(root.container.queryAll(node => node.props.testID === 'mock-skia-image')[0].props).toMatchObject({ width: 800, height: 600 });
    } finally { await act(async () => root.unmount()); ratio.mockRestore(); }
});

test('static preview accessibility labels retain active caption text', () => {
    const value = timeline();
    value.text = [{ id: 'caption', text: 'A spoken title', start: 0, len: 30, x: .5, y: .5, size: 6, trackId: 'text-0' }];
    expect(editorPreviewAccessibilityLabel(editorPreviewPlan(value, 5))).toContain('A spoken title');
});
