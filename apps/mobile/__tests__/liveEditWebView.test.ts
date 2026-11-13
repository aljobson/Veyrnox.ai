/* eslint-disable @typescript-eslint/no-require-imports */
declare const __dirname: string;
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
function runtime(count = 1, values = new Float32Array(64).fill(.8)) {
    const messages: any[] = [], close = jest.fn(), faceClose = jest.fn(), hairClose = jest.fn();
    const face = { detect: jest.fn(() => ({ faceLandmarks: Array.from({ length: count }, () => Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }))) })), close: faceClose };
    const mask = { width: 8, height: 8, getAsFloat32Array: () => values };
    const hair = { getLabels: () => ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'], segment: jest.fn(() => ({ confidenceMasks: Array(6).fill(mask), close })), close: hairClose };
    const Vision = { FaceLandmarker: { createFromOptions: jest.fn(async (_files: unknown, _options: unknown) => face) }, ImageSegmenter: { createFromOptions: jest.fn(async (_files: unknown, _options: unknown) => hair) } };
    const events: Record<string, () => void> = {};
    const window: any = { addEventListener: (name: string, f: () => void) => { events[name] = f; } };
    runInNewContext(readFileSync(resolve(__dirname, '../scripts/live-edit-webview.js'), 'utf8'), {
        window, Vision, LIVE_ASSETS: { face: '', hair: '', loader: 'data:loader', wasm: 'data:wasm' }, ReactNativeWebView: { postMessage: (raw: string) => messages.push(JSON.parse(raw)) },
        atob: () => '', Uint8Array, Image: class { naturalWidth = 32; naturalHeight = 32; onload = () => {}; set src(v: string) { if (v) this.onload(); } },
        document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) }) },
    });
    return { send: (m: object) => window.liveEditReceive(JSON.stringify(m)), messages, face, hair, close, Vision, dispose: () => events.pagehide(), faceClose, hairClose };
}
const request = { op: 'detect', id: 2, sourceId: 5, frameId: 7, width: 32, height: 32, jpeg: 'data:image/jpeg;base64,AAAA' };
test('WebView runs both pinned models, preserves ids, releases masks and models', async () => {
    const r = runtime(); await r.send({ op: 'init', id: 1 }); await r.send(request);
    expect(r.Vision.FaceLandmarker.createFromOptions.mock.calls[0][1]).toMatchObject({ numFaces: 2, runningMode: 'IMAGE' });
    expect(r.face.detect).toHaveBeenCalledTimes(1); expect(r.hair.segment).toHaveBeenCalledTimes(1);
    expect(r.messages[1]).toMatchObject({ sourceId: 5, frameId: 7, count: 1 }); expect(r.messages[1].landmarks).toHaveLength(1434);
    expect(r.close).toHaveBeenCalledTimes(1); r.dispose(); expect(r.faceClose).toHaveBeenCalledTimes(1); expect(r.hairClose).toHaveBeenCalledTimes(1);
});
test.each([0, 2])('count %i bypasses segmentation with an explicitly empty mask', async count => {
    const r = runtime(count); await r.send({ op: 'init', id: 1 }); await r.send(request);
    expect(r.hair.segment).not.toHaveBeenCalled(); expect(r.messages[1]).toMatchObject({ count, landmarks: [], hair: null });
});
test('bad confidence and over-sized requests fail closed without leaking masks', async () => {
    const r = runtime(1, new Float32Array(64).fill(NaN)); await r.send({ op: 'init', id: 1 }); await r.send(request);
    expect(r.messages[1]).toEqual({ id: 2, error: true }); expect(r.close).toHaveBeenCalledTimes(1);
    await r.send({ ...request, id: 3, width: 1000 }); expect(r.face.detect).toHaveBeenCalledTimes(1); expect(r.messages[2]).toEqual({ id: 3, error: true });
});
