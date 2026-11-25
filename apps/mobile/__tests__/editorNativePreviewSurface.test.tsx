import { act } from 'react';
import { View } from 'react-native';
import { createRoot } from 'test-renderer';
import { EditorNativePreviewSurface } from '../src/components/editor/EditorNativePreviewSurface';
import { emptyTimeline } from '../src/lib/nativeEditorModel';

const mockRender = jest.fn();
jest.mock('../src/lib/editorNativePreview', () => ({ renderNativeEditorPreviewFrame: (...args: unknown[]) => mockRender(...args) }));
jest.mock('@shopify/react-native-skia', () => ({
    Skia: { native: true },
    Canvas: (props: any) => require('react').createElement(require('react-native').View, { ...props, testID: props.testID }),
    Image: (props: any) => require('react').createElement(require('react-native').View, { ...props, testID: 'native-preview-image' }),
}));
void View;

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
};
const image = () => ({ dispose: jest.fn() });
const result = (value = image()) => ({ ok: true as const, image: value,
    plan: { referenceSize: { width: 1280, height: 720 } } });

beforeEach(() => { jest.clearAllMocks(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });

test('publishes only an exact native frame matching the current playhead', async () => {
    const output = image(), onDisplayed = jest.fn(); mockRender.mockResolvedValue(result(output));
    const root = createRoot(), timeline = emptyTimeline();
    try {
        await act(async () => root.render(<EditorNativePreviewSurface enabled account="account" project="project" timeline={timeline}
            frame={4} localMediaUris={{}} onDisplayed={onDisplayed} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-native-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        expect(mockRender).toHaveBeenCalledWith(expect.objectContaining({ account: 'account', project: 'project', frame: 4,
            width: 640, height: 360, signal: expect.any(AbortSignal) }));
        expect(root.container.queryAll(node => node.props.testID === 'native-preview-image')).toHaveLength(1);
        expect(onDisplayed).toHaveBeenLastCalledWith({ frame: 4, exact: true });
    } finally { await act(async () => root.unmount()); }
    expect(output.dispose).toHaveBeenCalledTimes(1);
});

test('rapid playback keeps one render in flight and replaces the trailing request with the newest frame', async () => {
    const first = deferred<ReturnType<typeof result>>(), latest = image(), onDisplayed = jest.fn();
    mockRender.mockImplementationOnce(() => first.promise).mockResolvedValueOnce(result(latest));
    const root = createRoot(), timeline = emptyTimeline();
    const render = (frame: number) => root.render(<EditorNativePreviewSurface enabled account="account" project="project" timeline={timeline}
        frame={frame} localMediaUris={{}} onDisplayed={onDisplayed} />);
    try {
        await act(async () => render(1));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-native-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        await act(async () => { render(2); render(3); });
        expect(mockRender).toHaveBeenCalledTimes(1);
        const stale = image();
        await act(async () => first.resolve(result(stale)));
        expect(mockRender).toHaveBeenCalledTimes(2);
        expect(mockRender.mock.calls[1][0]).toMatchObject({ frame: 3 });
        expect(stale.dispose).toHaveBeenCalledTimes(1);
        expect(onDisplayed).toHaveBeenLastCalledWith({ frame: 3, exact: true });
    } finally { await act(async () => root.unmount()); }
});

test('never redisplays a disposed frame and treats a same-frame timeline revision as stale', async () => {
    const first = image(), second = deferred<ReturnType<typeof result>>(), onDisplayed = jest.fn();
    mockRender.mockResolvedValueOnce(result(first)).mockImplementationOnce(() => second.promise);
    const root = createRoot(), timeline = emptyTimeline(), revised = { ...timeline, seq: timeline.seq + 1 };
    try {
        await act(async () => root.render(<EditorNativePreviewSurface enabled account="account" project="project" timeline={timeline}
            frame={4} localMediaUris={{}} onDisplayed={onDisplayed} />));
        const surface = root.container.queryAll(node => node.props.testID === 'editor-native-preview-surface')[0];
        await act(async () => surface.props.onLayout({ nativeEvent: { layout: { width: 320, height: 180 } } }));
        expect(onDisplayed).toHaveBeenLastCalledWith({ frame: 4, exact: true });
        await act(async () => root.render(<EditorNativePreviewSurface enabled account="account" project="project" timeline={revised}
            frame={4} localMediaUris={{}} onDisplayed={onDisplayed} />));
        expect(onDisplayed).toHaveBeenLastCalledWith(null);
        expect(first.dispose).not.toHaveBeenCalled();
        const next = image();
        await act(async () => second.resolve(result(next)));
        expect(first.dispose).toHaveBeenCalledTimes(1);
        expect(root.container.queryAll(node => node.props.testID === 'native-preview-image')).toHaveLength(1);
        expect(onDisplayed).toHaveBeenLastCalledWith({ frame: 4, exact: true });
    } finally { await act(async () => root.unmount()); }
});
