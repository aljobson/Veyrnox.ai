import { parseLiveEvent, liveMessage, liveErrorKey, LIVE_ERRORS } from '../src/lib/liveEdit/liveProtocol';
import { DEFAULT_STACK } from '../src/lib/liveEdit/engine';
const b64 = (bytes: number[], pad = 400) => btoa(String.fromCharCode(...bytes) + 'A'.repeat(pad));
const be = (n: number, width = 2) => width === 4 ? [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] : [(n >> 8) & 255, n & 255];
const jpegOf = (w = 1280, h = 720) => `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, ...be(h), ...be(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])}`;
const jpeg = (n = 400) => `data:image/jpeg;base64,${b64([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, ...be(720), ...be(1280), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], n)}`;
describe('live camera protocol', () => {
    it('accepts well-formed events', () => {
        expect(parseLiveEvent(JSON.stringify({ live: 'started', width: 1280, height: 720, cameras: 2 }))).toEqual({ live: 'started', width: 1280, height: 720, cameras: 2 });
        expect(parseLiveEvent(JSON.stringify({ live: 'face', status: 'one-face' }))).toEqual({ live: 'face', status: 'one-face' });
        expect(parseLiveEvent(JSON.stringify({ live: 'wig', status: 'face-required' }))).toEqual({ live: 'wig', status: 'face-required' });
        expect(parseLiveEvent(JSON.stringify({ live: 'stopped' }))).toEqual({ live: 'stopped' });
        expect(parseLiveEvent(JSON.stringify({ live: 'photo', id: 3, width: 1280, height: 720, jpeg: jpeg() }))).toMatchObject({ live: 'photo', id: 3 });
        // A header that disagrees with the claim, or asks for a decode that is too large, is dropped before any decoder runs.
        for (const [w, h, jpegData] of [[1280, 720, jpegOf(640, 480)], [5000, 4000, jpegOf(5000, 4000)], [4096, 4096, jpegOf(4096, 4096)], [1280, 720, `data:image/jpeg;base64,${'A'.repeat(300)}`]] as const)
            expect(parseLiveEvent(JSON.stringify({ live: 'photo', id: 1, width: w, height: h, jpeg: jpegData }))).toBeNull();
        expect(parseLiveEvent(JSON.stringify({ live: 'photo', id: 1, width: 1920, height: 1080, jpeg: jpegOf(1920, 1080) }))).toMatchObject({ live: 'photo' });
    });
    it('ignores anything malformed, oversized or unknown', () => {
        for (const raw of [undefined, null, 5, '', '{', '[]', 'null', JSON.stringify({ live: 'nope' }), JSON.stringify({ live: 'face', status: 'weird' }), JSON.stringify({ live: 'started', width: 4, height: 720, cameras: 1 }),
            JSON.stringify({ live: 'started', width: 1280, height: 720, cameras: -1 }), JSON.stringify({ live: 'wig', status: '__proto__' })]) expect(parseLiveEvent(raw)).toBeNull();
        expect(parseLiveEvent('x'.repeat(6_000_001))).toBeNull();
    });
    it('rejects photos that are not a bounded base64 JPEG data URL', () => {
        for (const bad of ['data:image/png;base64,AAAA', 'https://example.com/a.jpg', `data:image/jpeg;base64,${'A'.repeat(50)}`, `data:image/jpeg;base64,${'A'.repeat(300)}!`, jpeg(5_000_100), `${jpeg()}A`, 'file:///etc/passwd'])
            expect(parseLiveEvent(JSON.stringify({ live: 'photo', id: 1, width: 1280, height: 720, jpeg: bad }))).toBeNull();
        expect(parseLiveEvent(JSON.stringify({ live: 'photo', id: 1.5, width: 1280, height: 720, jpeg: jpeg() }))).toBeNull();
    });
    it('turns an unknown error code into the generic failure, never ignoring a dead camera', () => {
        expect(parseLiveEvent(JSON.stringify({ live: 'error', code: 'camera-denied' }))).toMatchObject({ code: 'camera-denied' });
        expect(parseLiveEvent(JSON.stringify({ live: 'error', code: 'something-new', detail: 'x'.repeat(500) }))).toMatchObject({ live: 'error', code: 'camera-failed' });
        expect((parseLiveEvent(JSON.stringify({ live: 'error', code: 'camera-failed', detail: 'x'.repeat(500) })) as { detail: string }).detail).toHaveLength(120);
    });
    it('every error code has a message key', () => { for (const code of LIVE_ERRORS) expect(['denied', 'missing', 'busy', 'unsupported', 'lost', 'failed']).toContain(liveErrorKey(code)); });
    it('builds normalized, bounded messages', () => {
        expect(JSON.parse(liveMessage('live.start'))).toEqual({ op: 'live.start' });
        expect(JSON.parse(liveMessage('live.compare', { value: true }))).toEqual({ op: 'live.compare', value: true });
        expect(JSON.parse(liveMessage('live.compare', { value: undefined }))).toEqual({ op: 'live.compare', value: false });
        expect(JSON.parse(liveMessage('live.capture', { id: 9 }))).toEqual({ op: 'live.capture', id: 9 });
        const settings = JSON.parse(liveMessage('live.settings', { settings: { ...DEFAULT_STACK, wig: { ...DEFAULT_STACK.wig, size: 99 } } })).settings;
        expect(settings.wig.size).toBe(1.3);
        expect(Object.keys(settings).sort()).toEqual(['hair', 'look', 'makeup', 'smoothing', 'strength', 'wig']);
    });
});
