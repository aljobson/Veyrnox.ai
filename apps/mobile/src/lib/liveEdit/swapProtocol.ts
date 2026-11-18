import { createProtocolJob, MAX_MESSAGE, type Frame, type FrameId, type VisionTransport, sameFrame } from './protocol';
export type SwapInference = FrameId & { width: number; height: number; count: 0 | 1 | 2; landmarks: Float32Array; background?: Uint8Array; body?: Uint8Array; face?: Uint8Array };
function mask(value: unknown, size: number): Uint8Array {
    if (typeof value !== 'string' || value.length !== 4 * Math.ceil(size / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw Error('invalid-mask');
    const decoded = atob(value);
    if (decoded.length !== size || btoa(decoded) !== value) throw Error('invalid-mask');
    return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
export function validateSwapResult(data: unknown, expected: FrameId & { width: number; height: number }): SwapInference {
    if (JSON.stringify(data).length > MAX_MESSAGE) throw Error('invalid-message');
    const d = data as Record<string, unknown>;
    const validId = (n: unknown) => Number.isSafeInteger(n) && Number(n) > 0 && Number(n) < 1_000_000;
    if (!d || !validId(d.id) || !validId(d.sourceId) || !validId(d.frameId) || !sameFrame(d as FrameId, expected) || d.width !== expected.width || d.height !== expected.height || !Number.isInteger(d.width) || !Number.isInteger(d.height) || Math.min(Number(d.width), Number(d.height)) < 8 || Math.max(Number(d.width), Number(d.height)) > 384 || ![0, 1, 2].includes(d.count as number)) throw Error('invalid-inference');
    const count = d.count as 0 | 1 | 2;
    if (!Array.isArray(d.landmarks) || d.landmarks.length !== (count === 1 ? 1434 : 0) || d.landmarks.some(v => typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 2)) throw Error('invalid-landmarks');
    const base = { ...expected, count, landmarks: new Float32Array(d.landmarks) };
    if (count !== 1) {
        if (['background', 'body', 'face'].some(k => k in d)) throw Error('invalid-mask');
        return base;
    }
    const size = expected.width * expected.height;
    return { ...base, background: mask(d.background, size), body: mask(d.body, size), face: mask(d.face, size) };
}
export function swapMasks(result: SwapInference) {
    if (result.count !== 1 || !result.background || !result.body || !result.face) throw Error('invalid_mask');
    return { width: result.width, height: result.height, background: Float32Array.from(result.background, v => v / 255), body: Float32Array.from(result.body, v => v / 255), face: Float32Array.from(result.face, v => v / 255) };
}
export const createSwapVisionJob = (transport: VisionTransport, timeoutMs = 15_000) => createProtocolJob<SwapInference>(transport, timeoutMs, 'swapDetect', (data, frame: Frame) => validateSwapResult(data, frame));
