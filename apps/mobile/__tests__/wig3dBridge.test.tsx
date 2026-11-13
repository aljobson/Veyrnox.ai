import { act } from 'react';
import { createRoot } from 'test-renderer';
import { Wig3dBridge, type Wig3dJob } from '../src/components/liveEdit/Wig3dBridge';
import { DEFAULT_STACK } from '../src/lib/liveEdit/engine';

type G = { __sent: string[]; __props: Record<string, any> | null };
const g = globalThis as unknown as G;
const mockPut = jest.fn(), mockGet = jest.fn();
jest.mock('react-native-webview', () => {
    const React = jest.requireActual('react');
    const WebView = React.forwardRef((props: Record<string, any>, ref: any) => {
        (globalThis as unknown as G).__props = props;
        React.useImperativeHandle(ref, () => ({ injectJavaScript: (js: string) => (globalThis as unknown as G).__sent.push(js) }));
        return null;
    });
    return { __esModule: true, default: WebView };
});
jest.mock('expo-asset', () => ({ Asset: { loadAsync: jest.fn(async () => [{ localUri: 'file:///cache/runtime.html' }]) } }));
jest.mock('../assets/live-edit/runtime.html', () => 1, { virtual: true });
jest.mock('../src/lib/liveEdit/wig', () => ({
    overlayKey: (wig: { style: string; size: number }, _p: unknown, w: number, h: number) => `${wig.style}|${wig.size}|${w}x${h}`,
    putOverlay: (...args: unknown[]) => mockPut(...args), getOverlay: (key: string) => mockGet(key),
}));
const messageOf = (js: string) => JSON.parse(JSON.parse(js.slice('window.liveEditReceive('.length, js.lastIndexOf(');true;'))));
const job = (size = 1): Wig3dJob => ({ wig: { ...DEFAULT_STACK.wig, style: '3d-bob', size }, landmarks: new Float32Array(1434).fill(0.5), width: 1000, height: 800 });
const b64 = (bytes: number[], pad = 400) => btoa(String.fromCharCode(...bytes) + 'A'.repeat(pad));
const be = (n: number, width = 2) => width === 4 ? [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] : [(n >> 8) & 255, n & 255];
const pngOf = (w: number, h: number) => `data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be(w, 4), ...be(h, 4), 8, 6, 0, 0, 0, 1, 2, 3, 4])}`;
const jpegOf = (w = 1280, h = 720) => `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, ...be(h), ...be(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])}`;
const png = pngOf(1000, 800); // the overlay size for a 1000 x 800 photo
const answer = (id: number, extra: Record<string, unknown> = {}) => JSON.stringify({ wig3d: true, id, status: 'ready', fade: 1, width: 1000, height: 800, png, ...extra });
async function mount(first = job()) {
    const onChange = jest.fn(), root = createRoot();
    await act(async () => root.render(<Wig3dBridge job={first} onChange={onChange} />));
    await act(async () => { await Promise.resolve(); });
    const receive = (raw: string) => act(async () => { g.__props?.onMessage({ nativeEvent: { data: raw } }); });
    return { root, onChange, receive, rerender: (next: Wig3dJob) => act(async () => root.render(<Wig3dBridge job={next} onChange={onChange} />)) };
}
beforeEach(() => { jest.useFakeTimers(); g.__sent = []; g.__props = null; mockPut.mockClear(); mockGet.mockReset(); });
afterEach(() => { jest.useRealTimers(); });

test('it is an isolated local document with no camera capture', async () => {
    const { root } = await mount();
    const p = g.__props!;
    expect(p.source).toEqual({ uri: 'file:///cache/runtime.html' }); expect(p.originWhitelist).toEqual(['*']);
    expect(p).toMatchObject({ domStorageEnabled: false, incognito: true, allowUniversalAccessFromFileURLs: false, mediaPlaybackRequiresUserAction: true });
    expect(p.mediaCapturePermissionGrantType).toBe('deny'); expect(p.allowsInlineMediaPlayback).toBeUndefined();
    expect(p.source.uri).not.toContain('#live'); // not the camera document
    expect(p.onShouldStartLoadWithRequest({ url: 'https://example.com/' })).toBe(false);
    expect(p.onShouldStartLoadWithRequest({ url: 'file:///cache/runtime.html' })).toBe(true);
    expect(p.onShouldStartLoadWithRequest({ url: 'file:///cache/runtime.html#live' })).toBe(false); // a hidden view can never reload itself as the camera document
    await act(async () => root.unmount());
});
test('after load it asks once for the current job, then stores the matching reply and tells the screen', async () => {
    const { root, onChange, receive } = await mount();
    await act(async () => { g.__props!.onLoadEnd(); jest.advanceTimersByTime(200); });
    const asked = g.__sent.map(messageOf); expect(asked).toHaveLength(1); expect(asked[0]).toMatchObject({ op: 'wig3d', style: '3d-bob', width: 1000, height: 800 });
    await receive(answer(asked[0].id + 9)); expect(mockPut).not.toHaveBeenCalled(); // a reply to some other id is dropped
    await receive(answer(asked[0].id, { png: pngOf(500, 400), width: 500, height: 400 })); expect(mockPut).not.toHaveBeenCalled(); // an overlay of any other size is dropped, the request stays pending
    await receive(answer(asked[0].id));
    expect(mockPut).toHaveBeenCalledWith('3d-bob|1|1000x800', { status: 'ready', png: png.slice('data:image/png;base64,'.length), fade: 1 }); expect(onChange).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
});
test('a job whose overlay already exists is not requested again', async () => {
    mockGet.mockReturnValue({ status: 'ready' });
    const { root } = await mount();
    await act(async () => { g.__props!.onLoadEnd(); jest.advanceTimersByTime(200); });
    expect(g.__sent).toEqual([]);
    await act(async () => root.unmount());
});
test('while one request is in flight a newer job waits, then the latest one is asked for', async () => {
    const { root, receive, rerender } = await mount(job(1));
    await act(async () => { g.__props!.onLoadEnd(); jest.advanceTimersByTime(200); });
    await rerender(job(1.1)); await rerender(job(1.2)); await act(async () => { jest.advanceTimersByTime(200); });
    expect(g.__sent).toHaveLength(1); // still the first
    await receive(answer(messageOf(g.__sent[0]).id));
    const next = g.__sent.map(messageOf); expect(next).toHaveLength(2); expect(next[1].size).toBe(1.2); // the intermediate 1.1 was never asked for
    await act(async () => root.unmount());
});
test('a request that never answers ends as unavailable instead of hanging', async () => {
    const { root, onChange } = await mount();
    await act(async () => { g.__props!.onLoadEnd(); jest.advanceTimersByTime(200); });
    await act(async () => { jest.advanceTimersByTime(30_001); });
    expect(mockPut).toHaveBeenCalledWith('3d-bob|1|1000x800', { status: 'unavailable' }); expect(onChange).toHaveBeenCalled();
    await act(async () => root.unmount());
});
test('a crashed WebView ends the pending request as unavailable', async () => {
    const { root } = await mount();
    await act(async () => { g.__props!.onLoadEnd(); jest.advanceTimersByTime(200); });
    await act(async () => { g.__props!.onContentProcessDidTerminate(); });
    expect(mockPut).toHaveBeenCalledWith('3d-bob|1|1000x800', { status: 'unavailable' });
    await act(async () => root.unmount());
});

test('a crash while a newer job is waiting settles BOTH, and every later job is unavailable at once', async () => {
    const { root, onChange, rerender } = await mount(job(1));
    await act(async () => { g.__props!.onLoadEnd(); jest.advanceTimersByTime(200); });
    await rerender(job(1.5));
    await act(async () => { g.__props!.onContentProcessDidTerminate(); });
    expect(mockPut).toHaveBeenCalledWith('3d-bob|1|1000x800', { status: 'unavailable' }); // the one in flight
    expect(mockPut).toHaveBeenCalledWith('3d-bob|1.5|1000x800', { status: 'unavailable' }); // the one that was waiting
    mockPut.mockClear(); onChange.mockClear();
    await rerender(job(1.2)); await act(async () => { jest.advanceTimersByTime(200); });
    expect(mockPut).toHaveBeenCalledWith('3d-bob|1.2|1000x800', { status: 'unavailable' }); expect(g.__sent.map(messageOf)).toHaveLength(1); // nothing new is asked of a dead view
    await act(async () => root.unmount());
});
test('a document that never finishes loading ends as unavailable instead of loading forever', async () => {
    const { root } = await mount();
    await act(async () => { jest.advanceTimersByTime(45_001); });
    expect(mockPut).toHaveBeenCalledWith('3d-bob|1|1000x800', { status: 'unavailable' }); expect(g.__sent).toEqual([]);
    await act(async () => root.unmount());
});

test('an overlay that cannot be stored ends as unavailable, and the next request still goes out', async () => {
    const { root, onChange, receive, rerender } = await mount(job(1));
    await act(async () => { g.__props!.onLoadEnd(); jest.advanceTimersByTime(200); });
    await rerender(job(1.3));
    mockPut.mockImplementationOnce(() => { throw Error('Skia could not decode the data'); });
    await receive(answer(messageOf(g.__sent[0]).id));
    expect(mockPut).toHaveBeenLastCalledWith('3d-bob|1|1000x800', { status: 'unavailable' }); expect(onChange).toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(200); });
    expect(g.__sent.map(messageOf)).toHaveLength(2); // not stuck: the waiting job was asked for
    await act(async () => root.unmount());
});
