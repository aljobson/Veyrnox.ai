import { act, createRef } from 'react';
import { createRoot } from 'test-renderer';
import * as ImagePicker from 'expo-image-picker';
import { LiveCameraView, type LiveCameraHandle } from '../src/components/liveEdit/LiveCameraView';
import { DEFAULT_STACK } from '../src/lib/liveEdit/engine';

type G = { __sent: string[]; __props: Record<string, any> | null; __written: Uint8Array | null };
const g = globalThis as unknown as G;
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
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })) }));
jest.mock('expo-file-system', () => {
    class File { uri: string; exists = true; constructor(_dir: unknown, name: string) { this.uri = `file:///cache/${name}`; } create() {} write(bytes: Uint8Array) { if ((globalThis as unknown as { __failWrite?: boolean }).__failWrite) throw Error('disk full'); (globalThis as unknown as G).__written = bytes; } delete() { (globalThis as unknown as { __deleted?: string[] }).__deleted = [...((globalThis as unknown as { __deleted?: string[] }).__deleted ?? []), this.uri]; } }
    return { File, Paths: { cache: { uri: 'file:///cache/' } } };
});
jest.mock('../src/lib/i18n', () => ({ t: (key: string) => key }));
jest.mock('../assets/live-edit/runtime.html', () => 1, { virtual: true });

const messageOf = (js: string) => JSON.parse(JSON.parse(js.slice('window.liveEditReceive('.length, js.lastIndexOf(');true;'))));
const b64 = (bytes: number[], pad = 400) => btoa(String.fromCharCode(...bytes) + 'A'.repeat(pad));
const be = (n: number, width = 2) => width === 4 ? [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] : [(n >> 8) & 255, n & 255];
const pngOf = (w: number, h: number) => `data:image/png;base64,${b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be(w, 4), ...be(h, 4), 8, 6, 0, 0, 0, 1, 2, 3, 4])}`;
const jpegOf = (w = 1280, h = 720) => `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, ...be(h), ...be(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])}`;
const jpeg = (_n = 400) => jpegOf(1280, 720);
async function mount(overrides: Partial<React.ComponentProps<typeof LiveCameraView>> = {}) {
    const handle = createRef<LiveCameraHandle>(), calls = { started: jest.fn(), face: jest.fn(), wig: jest.fn(), error: jest.fn(), photo: jest.fn() };
    const root = createRoot();
    await act(async () => root.render(<LiveCameraView ref={handle} stack={DEFAULT_STACK} compare={false} height={300}
        onStarted={calls.started} onFace={calls.face} onWig={calls.wig} onError={calls.error} onPhoto={calls.photo} {...overrides} />));
    await act(async () => { await Promise.resolve(); });
    return { root, handle, calls, receive: (data: unknown) => act(async () => { g.__props?.onMessage({ nativeEvent: { data: typeof data === 'string' ? data : JSON.stringify(data) } }); }) };
}
beforeEach(() => { g.__sent = []; g.__props = null; g.__written = null; jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: true } as never); });

test('a denied OS permission never mounts the WebView, so the camera is never requested', async () => {
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({ granted: false } as never);
    const { root, calls } = await mount();
    expect(calls.error).toHaveBeenCalledWith('camera-denied'); expect(g.__props).toBeNull();
    await act(async () => root.unmount());
});
test('the WebView is an isolated local document that may play the camera inline and nothing else', async () => {
    const { root } = await mount();
    const p = g.__props!;
    expect(p.source).toEqual({ uri: 'file:///cache/runtime.html#live' }); // the only document that may open the camera
    // '*' so react-native-webview never opens an unlisted URL in the OS browser itself; the callback below is the only gate.
    expect(p.originWhitelist).toEqual(['*']);
    expect(p).toMatchObject({ javaScriptEnabled: true, domStorageEnabled: false, cacheEnabled: false, incognito: true, allowUniversalAccessFromFileURLs: false, allowFileAccessFromFileURLs: false,
        allowsInlineMediaPlayback: true, mediaPlaybackRequiresUserAction: false, mediaCapturePermissionGrantType: 'grant', mixedContentMode: 'never', setSupportMultipleWindows: false });
    expect(p.onShouldStartLoadWithRequest({ url: 'https://example.com/' })).toBe(false);
    expect(p.onShouldStartLoadWithRequest({ url: 'file:///cache/runtime.html#live' })).toBe(true);
    expect(p.onShouldStartLoadWithRequest({ url: 'file:///cache/runtime.html' })).toBe(false); // exactly the camera document
    expect(p.onShouldStartLoadWithRequest({ url: 'file:///cache/runtime.html#other' })).toBe(false);
    expect(p.onShouldStartLoadWithRequest({ url: 'intent://camera' })).toBe(false);
    await act(async () => root.unmount());
});
test('start, settings and compare are sent in order once the page reports started', async () => {
    const { root, calls, receive } = await mount({ compare: true });
    await act(async () => { g.__props!.onLoadEnd(); });
    expect(g.__sent.map(messageOf)).toEqual([{ op: 'live.start' }]);
    await receive({ live: 'started', width: 1280, height: 720, cameras: 2 });
    expect(calls.started).toHaveBeenCalledWith(2);
    const after = g.__sent.map(messageOf).slice(1);
    expect(after.map(m => m.op)).toEqual(['live.settings', 'live.compare']); expect(after[1].value).toBe(true);
    await act(async () => root.unmount());
});
test('status events pass through; malformed, unknown or oversized messages are ignored', async () => {
    const { root, calls, receive } = await mount();
    await receive({ live: 'face', status: 'one-face' }); await receive({ live: 'wig', status: 'face-required' });
    expect(calls.face).toHaveBeenCalledWith('one-face'); expect(calls.wig).toHaveBeenCalledWith('face-required');
    for (const bad of ['not json', { live: 'face', status: 'invented' }, { live: 'photo', id: 1, width: 1280, height: 720, jpeg: 'https://example.com/x.jpg' }, { live: 'unknown' }]) await receive(bad);
    expect(calls.face).toHaveBeenCalledTimes(1); expect(calls.error).not.toHaveBeenCalled(); expect(calls.photo).not.toHaveBeenCalled();
    await act(async () => root.unmount());
});
test('a page error, a dead WebView or a crashed process reports the error and stops', async () => {
    const { root, calls, receive } = await mount();
    await receive({ live: 'error', code: 'camera-busy' }); expect(calls.error).toHaveBeenLastCalledWith('camera-busy');
    await act(async () => { g.__props!.onContentProcessDidTerminate(); }); expect(calls.error).toHaveBeenLastCalledWith('camera-failed');
    await act(async () => root.unmount());
});
test('a captured frame is written to a cache file only for the pending request id', async () => {
    const { root, handle, calls, receive } = await mount();
    await act(async () => { g.__props!.onLoadEnd(); }); await receive({ live: 'started', width: 1280, height: 720, cameras: 1 });
    await act(async () => { handle.current!.capture(); });
    const request = g.__sent.map(messageOf).find(m => m.op === 'live.capture')!; expect(request.id).toBeGreaterThan(0);
    await receive({ live: 'photo', id: request.id + 5, width: 1280, height: 720, jpeg: jpeg() }); expect(calls.photo).not.toHaveBeenCalled();
    await receive({ live: 'photo', id: request.id, width: 1280, height: 720, jpeg: jpeg() });
    expect(calls.photo).toHaveBeenCalledTimes(1); expect(calls.photo.mock.calls[0][0]).toMatch(/^file:\/\/\/cache\/live-camera-\d+\.jpg$/);
    expect(g.__written).toBeInstanceOf(Uint8Array); expect(g.__written!.length).toBeGreaterThan(100);
    await receive({ live: 'photo', id: request.id, width: 1280, height: 720, jpeg: jpeg() }); expect(calls.photo).toHaveBeenCalledTimes(1); // one answer per request
    await act(async () => root.unmount());
});
test('capture and switch are ignored before the camera has started', async () => {
    const { root, handle } = await mount();
    await act(async () => { handle.current!.capture(); handle.current!.switchCamera(); });
    expect(g.__sent).toEqual([]);
    await act(async () => root.unmount());
});

test('a capture that cannot be written deletes its partial cache file and reports the failure', async () => {
    const holder = globalThis as unknown as { __failWrite?: boolean; __deleted?: string[] };
    holder.__failWrite = true; holder.__deleted = [];
    const { root, handle, calls, receive } = await mount();
    await act(async () => { g.__props!.onLoadEnd(); }); await receive({ live: 'started', width: 1280, height: 720, cameras: 1 });
    await act(async () => { handle.current!.capture(); });
    const request = g.__sent.map(messageOf).find(m => m.op === 'live.capture')!;
    await receive({ live: 'photo', id: request.id, width: 1280, height: 720, jpeg: jpeg() });
    expect(calls.photo).not.toHaveBeenCalled(); expect(calls.error).toHaveBeenCalledWith('export-failed'); expect(holder.__deleted).toHaveLength(1);
    holder.__failWrite = false;
    await act(async () => root.unmount());
});
