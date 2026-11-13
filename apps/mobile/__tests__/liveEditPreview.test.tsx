import { act } from 'react';
import { createRoot } from 'test-renderer';
import { EffectPhoto } from '../src/components/liveEdit/EffectPhoto';
import { DEFAULT_STACK } from '../src/lib/liveEdit/engine';
import type { LocalSource } from '../src/lib/liveEdit/media';
const mockFirst = { dispose: jest.fn() }, mockSecond = { dispose: jest.fn() };
const mockSnapshot = jest.fn(), mockImage = {};
const mockRender = jest.fn();
jest.mock('../src/lib/liveEdit/renderEffectStack', () => ({ renderEffectStack: (...args: unknown[]) => mockRender(...args) }));
jest.mock('@shopify/react-native-skia', () => {
    const React = jest.requireActual('react');
    return {
        useImage: () => mockImage, useCanvasRef: () => React.useRef(null), Skia: { XYWHRect: () => ({}) },
        Canvas: React.forwardRef((_props: unknown, ref: unknown) => { React.useImperativeHandle(ref, () => ({ makeImageSnapshotAsync: mockSnapshot })); return null; }),
        Group: () => null, Picture: () => null,
    };
});
test('preview swaps pictures before disposal and becomes ready only after native draw fence', async () => {
    jest.useFakeTimers();
    const root = createRoot(), ready = jest.fn(), error = jest.fn();
    const source = { uri: 'file:///photo.png', sourceId: 1, frameId: 1, width: 10, height: 10 } as LocalSource;
    mockRender.mockReturnValueOnce(mockFirst).mockReturnValueOnce(mockSecond);
    let finish: ((v: { dispose(): void }) => void) | undefined;
    mockSnapshot.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    try {
        await act(async () => root.render(<EffectPhoto source={source} stack={DEFAULT_STACK} inference={null} label="fixture" maxHeight={100} onReady={ready} onError={error} />));
        const host = root.container.queryAll(n => n.props.accessibilityRole === 'image')[0];
        await act(async () => host.props.onLayout({ nativeEvent: { layout: { width: 100 } } }));
        expect(ready).not.toHaveBeenCalled();
        await act(async () => { jest.advanceTimersByTime(20); });
        const snapshot = { dispose: jest.fn() };
        await act(async () => finish!(snapshot));
        expect(ready).toHaveBeenCalledTimes(1); expect(snapshot.dispose).toHaveBeenCalled();
        await act(async () => root.render(<EffectPhoto source={source} stack={{ ...DEFAULT_STACK, smoothing: .5 }} inference={null} label="fixture" maxHeight={100} onReady={ready} onError={error} />));
        expect(mockFirst.dispose).not.toHaveBeenCalled(); expect(ready).toHaveBeenCalledTimes(1);
        await act(async () => { jest.advanceTimersByTime(20); });
        await act(async () => finish!(snapshot));
        expect(mockFirst.dispose).toHaveBeenCalledTimes(1); expect(ready).toHaveBeenCalledTimes(2);
        expect(error).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); jest.useRealTimers(); }
    expect(mockSecond.dispose).toHaveBeenCalledTimes(1);
});
