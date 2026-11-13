import { MAX_MESSAGE } from './protocol';
import { normalizeStack, type Stack } from './engine';
import { jpegSize, pngSize } from './imageHeader';

// Live camera boundary (ADR-0338 S8). The WebView page runs the camera, the face tracker and the web live engine; this side only
// sends settings and commands and validates every reply as untrusted data (strict allowlists, size caps, no pass-through).
export const LIVE_FACE = ['detecting', 'one-face', 'no-face', 'multiple-faces', 'face-unavailable'] as const;
export const LIVE_WIG = ['off', 'face-required', 'loading', 'unavailable', 'ready', 'angle', 'coverage-unknown', 'uncovered', 'angle-uncovered'] as const;
export const LIVE_ERRORS = ['camera-denied', 'camera-missing', 'camera-busy', 'camera-unsupported', 'camera-failed', 'camera-lost', 'camera-blocked', 'camera-hidden',
    'camera-not-ready', 'graphics-unavailable', 'graphics-lost', 'photo-too-large', 'live-unavailable', 'live-busy', 'face-unavailable', 'export-failed'] as const;
export type LiveFace = typeof LIVE_FACE[number];
export type LiveWig = typeof LIVE_WIG[number];
export type LiveError = typeof LIVE_ERRORS[number];
export type LiveEvent =
    | { live: 'started'; width: number; height: number; cameras: number }
    | { live: 'face'; status: LiveFace }
    | { live: 'wig'; status: LiveWig }
    | { live: 'error'; code: LiveError; detail?: string }
    | { live: 'photo'; id: number; width: number; height: number; base64: string }
    | { live: 'stopped' };

const JPEG_PREFIX = 'data:image/jpeg;base64,';
const MAX_PHOTO_BASE64 = 5_000_000; // a 1080p frame is well under 1 MB; the transport cap is MAX_MESSAGE
const MAX_PHOTO_SIDE = 4096, MAX_PHOTO_PIXELS = 8_500_000; // a camera frame is at most 1920x1080 here; refuse anything that would decode to more
const dimension = (v: unknown): v is number => Number.isInteger(v) && Number(v) >= 8 && Number(v) <= 8192;
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** Parses one WebView message. Anything malformed, oversized or unknown returns null (and is ignored by the caller). */
export function parseLiveEvent(raw: unknown): LiveEvent | null {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return null;
    let d: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(raw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null; d = parsed as Record<string, unknown>; } catch { return null; }
    switch (d.live) {
    case 'started': return dimension(d.width) && dimension(d.height) && Number.isInteger(d.cameras) && Number(d.cameras) >= 0 && Number(d.cameras) < 16
        ? { live: 'started', width: d.width, height: d.height, cameras: Number(d.cameras) } : null;
    case 'face': return oneOf(LIVE_FACE, d.status) ? { live: 'face', status: d.status } : null;
    case 'wig': return oneOf(LIVE_WIG, d.status) ? { live: 'wig', status: d.status } : null;
    // An unknown code is still an error: show the generic message rather than ignoring a dead camera.
    case 'error': return { live: 'error', code: oneOf(LIVE_ERRORS, d.code) ? d.code : 'camera-failed', detail: typeof d.detail === 'string' ? d.detail.slice(0, 120) : undefined };
    case 'photo': {
        const jpeg = d.jpeg;
        if (!Number.isInteger(d.id) || !dimension(d.width) || !dimension(d.height) || typeof jpeg !== 'string' || !jpeg.startsWith(JPEG_PREFIX)) return null;
        const base64 = jpeg.slice(JPEG_PREFIX.length);
        if (base64.length < 100 || base64.length > MAX_PHOTO_BASE64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
        // The header must really say what the message claims, within a decode budget, before anything decodes it.
        const size = jpegSize(base64);
        if (!size || size.width !== d.width || size.height !== d.height || Math.max(size.width, size.height) > MAX_PHOTO_SIDE || size.width * size.height > MAX_PHOTO_PIXELS) return null;
        return { live: 'photo', id: Number(d.id), width: d.width, height: d.height, base64 };
    }
    case 'stopped': return { live: 'stopped' };
    default: return null;
    }
}

export type LiveOp = 'live.start' | 'live.settings' | 'live.compare' | 'live.switch' | 'live.capture' | 'live.stop';
/** One message to the page. Settings are normalized here so a hand-edited stack can never reach the page unvalidated. */
export function liveMessage(op: LiveOp, payload: { settings?: Stack; value?: boolean; id?: number } = {}): string {
    const body: Record<string, unknown> = { op };
    if (op === 'live.settings') body.settings = normalizeStack(payload.settings);
    if (op === 'live.compare') body.value = payload.value === true;
    if (op === 'live.capture') body.id = Number.isSafeInteger(payload.id) ? payload.id : 1;
    const text = JSON.stringify(body);
    if (text.length > 30_000) throw Error('live-message-too-large');
    return text;
}

/** Map a page error (or a native permission result) to the message key shown to the person. */
export function liveErrorKey(code: LiveError): 'denied' | 'missing' | 'busy' | 'unsupported' | 'lost' | 'failed' {
    switch (code) {
    case 'camera-denied': case 'camera-blocked': return 'denied';
    case 'camera-missing': return 'missing';
    case 'camera-busy': return 'busy';
    case 'camera-unsupported': case 'live-unavailable': case 'graphics-unavailable': return 'unsupported';
    case 'camera-lost': case 'camera-hidden': case 'graphics-lost': return 'lost';
    default: return 'failed';
    }
}

// ---- 3D wig overlay (S9): one request, one reply, matched by id. The reply is untrusted data like every other message. ----
export type Wig3dReply = { id: number; status: 'ready' | 'angle' | 'face-required' | 'unavailable'; fade: number; png?: string };
const PNG_PREFIX = 'data:image/png;base64,';
const MAX_OVERLAY_BASE64 = 5_000_000;
export function wig3dRequest(request: { id: number; style: string; size: number; offset: number; landmarks: Float32Array; width: number; height: number }): string {
    if (!Number.isSafeInteger(request.id) || request.landmarks.length !== 1434 || !dimension(request.width) || !dimension(request.height)) throw Error('invalid-wig3d-request');
    return JSON.stringify({ op: 'wig3d', id: request.id, style: request.style, size: request.size, offset: request.offset, width: request.width, height: request.height, landmarks: Array.from(request.landmarks) });
}
const MAX_OVERLAY_SIDE = 1024;
/** The size of the overlay the page renders for a photo of w x h: its longer side is capped at 1024 (the same rule the page uses). */
export function overlaySize(width: number, height: number): { width: number; height: number } {
    const ratio = Math.min(1, MAX_OVERLAY_SIDE / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
/** `expected` is the overlay size of the photo the request was for; a reply of any other size (or an inconsistent header) is dropped. */
export function parseWig3dReply(raw: unknown, expectedId: number, expected?: { width: number; height: number }): Wig3dReply | null {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return null;
    let d: Record<string, unknown>;
    try { const parsed: unknown = JSON.parse(raw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null; d = parsed as Record<string, unknown>; } catch { return null; }
    if (d.wig3d !== true || d.id !== expectedId) return null;
    if (!oneOf(['ready', 'angle', 'face-required', 'unavailable'] as const, d.status)) return null;
    if (d.status !== 'ready') return { id: expectedId, status: d.status, fade: d.status === 'angle' ? 0 : 1 };
    const png = d.png;
    if (typeof d.fade !== 'number' || !(d.fade >= 0 && d.fade <= 1) || !dimension(d.width) || !dimension(d.height) || typeof png !== 'string' || !png.startsWith(PNG_PREFIX)) return null;
    const base64 = png.slice(PNG_PREFIX.length);
    if (base64.length < 100 || base64.length > MAX_OVERLAY_BASE64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
    const size = pngSize(base64);
    if (!size || size.width !== d.width || size.height !== d.height || Math.max(size.width, size.height) > MAX_OVERLAY_SIDE || (expected && (size.width !== expected.width || size.height !== expected.height))) return null;
    return { id: expectedId, status: 'ready', fade: d.fade, png: base64 };
}
