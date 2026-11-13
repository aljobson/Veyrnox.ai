import { hairTexture, selectFaceHair, type HairMask } from './engine';
export const MAX_MESSAGE = 6_000_000;
export const MAX_INPUT = 900_000;
export type FrameId = { sourceId: number; frameId: number };
export type Frame = FrameId & { width: number; height: number; jpeg: string };
export type Inference = FrameId & { count: 0 | 1 | 2; landmarks: Float32Array; hair: HairMask | null };
const id = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0 && Number(n) < 1_000_000;
export const sameFrame = (a: FrameId, b: FrameId) => a.sourceId === b.sourceId && a.frameId === b.frameId;
export function validateFrame(frame: Frame): void {
    if (!id(frame.sourceId) || !id(frame.frameId) || !Number.isInteger(frame.width) || !Number.isInteger(frame.height) || Math.min(frame.width, frame.height) < 8 || Math.max(frame.width, frame.height) > 384 || typeof frame.jpeg !== 'string' || frame.jpeg.length > MAX_INPUT || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(frame.jpeg)) throw Error('invalid-frame');
}
export function validateResult(data: unknown, expected: FrameId): Inference {
    const d = data as Record<string, unknown> | null;
    if (!d || !id(d.sourceId) || !id(d.frameId) || !sameFrame(d as FrameId, expected) || ![0, 1, 2].includes(Number(d.count)) || typeof d.count !== 'number') throw Error('invalid-inference');
    const count = d.count as 0 | 1 | 2;
    if (!Array.isArray(d.landmarks) || d.landmarks.length !== (count === 1 ? 1434 : 0) || d.landmarks.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 2)) throw Error('invalid-landmarks');
    const landmarks = new Float32Array(d.landmarks);
    // No face (or multiple faces) never retains an old mask.
    if (count !== 1) {
        if (d.hair !== null) throw Error('invalid-hair-mask');
        return { ...expected, count, landmarks, hair: null };
    }
    if (!Number.isInteger(d.width) || !Number.isInteger(d.height) || Math.min(Number(d.width), Number(d.height)) < 8 || Math.max(Number(d.width), Number(d.height)) > 512 || !Array.isArray(d.hair) || d.hair.length !== Number(d.width) * Number(d.height) || d.hair.some(v => !Number.isInteger(v) || v < 0 || v > 255)) throw Error('invalid-hair-mask');
    const selected = selectFaceHair({ width: Number(d.width), height: Number(d.height), hair: Float32Array.from(d.hair as number[], v => v / 255) }, landmarks);
    return { ...expected, count, landmarks, hair: hairTexture(selected) ? selected : null };
}
// Native/WebView isolation boundary. Closing must unmount the WebView to terminate WASM work.
export interface VisionTransport { send(message: string): void; close(): void }
export function createVisionJob(transport: VisionTransport, timeoutMs = 15_000) {
    let closed = false, sequence = 0;
    let pending: { id: number; frame?: FrameId; resolve(value: Inference | null): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> } | undefined;
    const close = (reason = Error('inference-cancelled')) => {
        if (closed) return;
        closed = true;
        if (pending) { clearTimeout(pending.timer); pending.reject(reason); pending = undefined; }
        transport.close();
    };
    function request(frame?: Frame): Promise<Inference | null> {
        if (closed) return Promise.reject(Error('inference-cancelled'));
        if (pending) return Promise.reject(Error('inference-busy'));
        if (frame) { try { validateFrame(frame); } catch (e) { return Promise.reject(e); } }
        return new Promise((resolve, reject) => {
            const requestId = ++sequence;
            const timer = setTimeout(() => close(Error('inference-timeout')), frame ? timeoutMs : 60_000);
            pending = { id: requestId, frame, resolve, reject, timer };
            try { transport.send(JSON.stringify({ op: frame ? 'detect' : 'init', id: requestId, ...frame })); }
            catch { close(Error('inference-unavailable')); }
        });
    }
    return {
        init: () => request(), detect: (frame: Frame) => request(frame) as Promise<Inference>, close,
        receive(message: string) {
            if (closed || !pending) return;
            try {
                if (typeof message !== 'string' || message.length > MAX_MESSAGE) throw Error('invalid-message');
                const d = JSON.parse(message);
                if (d?.id !== pending.id) return;
                if (d.error) throw Error('inference-unavailable');
                const value = pending.frame ? validateResult(d, pending.frame) : null;
                if (!pending.frame && d.ready !== true) throw Error('inference-unavailable');
                const p = pending; pending = undefined; clearTimeout(p.timer); p.resolve(value);
            } catch { close(Error('invalid-inference')); }
        },
    };
}
