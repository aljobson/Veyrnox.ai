// Spike B1 (docs/mobile/spikes/B1-BEAT-ENGINE-WEBVIEW.md): pure helpers for the dev-only beat engine harness.
// Nothing outside the hidden route imports this file.

export const B1_FLAG = 'EXPO_PUBLIC_DEV_B1_BEAT_SPIKE';
export const spikeEnabled = (value: string | undefined): boolean => value === '1';

// The plan's pass line (docs/mobile/MUSIC-PLAN-2026-11-18.md, Spike B1).
export const B1_MAX_PAD_MS = 100;
export const B1_TRACKS = 8;
export const B1_PLAY_SECONDS = 300;
// The page beats once a second while playing; this long without one while the app is in front is a frozen page.
export const FROZEN_AFTER_MS = 5_000;

// The page is a loadHTMLString document. An https base address makes it a secure context (AudioWorklet and
// getUserMedia need one) without any network request; the .invalid name can never resolve.
export const SPIKE_BASE_URL = 'https://beat-spike.invalid/';

export type PageMessage =
    | { readonly type: 'ready' }
    | { readonly type: 'pad'; readonly source: string; readonly jsMs: number; readonly graphMs: number; readonly baseMs: number; readonly outMs: number | null; readonly nativeToPageMs: number | null }
    | { readonly type: 'beat'; readonly tracks: number; readonly seconds: number; readonly notes: number; readonly heapMb: number | null; readonly state: string; readonly audioTime: number; readonly stalls: number; readonly hidden: boolean }
    | { readonly type: 'visibility'; readonly hidden: boolean; readonly ctx: string; readonly audioTime: number }
    | { readonly type: 'ctxstate'; readonly state: string }
    | { readonly type: 'caps'; readonly [key: string]: unknown }
    | { readonly type: 'mic'; readonly ok: boolean; readonly name?: string }
    | { readonly type: 'note'; readonly text: string }
    | { readonly type: 'error'; readonly message: string };

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parsePageMessage(raw: string): PageMessage | null {
    if (raw.length > 4_000) return null;
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        return null;
    }
    if (!data || typeof data !== 'object') return null;
    const m = data as Record<string, unknown>;
    switch (m.type) {
        case 'ready':
            return { type: 'ready' };
        case 'pad': {
            const jsMs = num(m.jsMs), graphMs = num(m.graphMs), baseMs = num(m.baseMs);
            if (jsMs === null || graphMs === null || baseMs === null || typeof m.source !== 'string') return null;
            return { type: 'pad', source: m.source.slice(0, 12), jsMs, graphMs, baseMs, outMs: num(m.outMs), nativeToPageMs: num(m.nativeToPageMs) };
        }
        case 'beat': {
            const tracks = num(m.tracks), seconds = num(m.seconds), notes = num(m.notes), audioTime = num(m.audioTime), stalls = num(m.stalls);
            if (tracks === null || seconds === null || notes === null || audioTime === null || stalls === null || typeof m.state !== 'string') return null;
            return { type: 'beat', tracks, seconds, notes, heapMb: num(m.heapMb), state: m.state.slice(0, 16), audioTime, stalls, hidden: m.hidden === true };
        }
        case 'visibility': {
            const audioTime = num(m.audioTime);
            return audioTime === null || typeof m.ctx !== 'string' ? null : { type: 'visibility', hidden: m.hidden === true, ctx: m.ctx.slice(0, 16), audioTime };
        }
        case 'ctxstate':
            return typeof m.state === 'string' ? { type: 'ctxstate', state: m.state.slice(0, 16) } : null;
        case 'caps':
            return { ...m, type: 'caps' } as PageMessage;
        case 'mic':
            return { type: 'mic', ok: m.ok === true, name: typeof m.name === 'string' ? m.name.slice(0, 40) : undefined };
        case 'note':
            return typeof m.text === 'string' ? { type: 'note', text: m.text.slice(0, 160) } : null;
        case 'error':
            return typeof m.message === 'string' ? { type: 'error', message: m.message.slice(0, 160) } : null;
        default:
            return null;
    }
}

export function median(values: readonly number[]): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export interface PadSample {
    readonly source: string;
    readonly jsMs: number;
    readonly graphMs: number;
    readonly baseMs: number;
    readonly outMs: number | null;
    // Native tap to the page's hit handler, for taps made on a native pad over the web view; null for a tap in the page.
    readonly bridgeMs?: number | null;
}

// "Software" latency a person can feel from the page's side: tap handler work plus the time inside the audio graph.
// It leaves out the speaker path (outputLatency, unknown on Safari and on a simulator): the device checklist adds that by ear/loopback.
export const softwareMs = (s: PadSample): number => s.jsMs + s.graphMs + (s.bridgeMs ?? 0);

export interface Verdict {
    readonly padMedianMs: number | null;
    readonly padPass: boolean | null;
    readonly playedSeconds: number;
    readonly playPass: boolean;
    readonly kills: number;
    readonly killPass: boolean;
    readonly backgroundPass: boolean | null;
}

export interface LogEvent {
    readonly at: number;
    readonly kind: string;
    readonly detail?: string;
}

export const appendEvent = (log: readonly LogEvent[], event: LogEvent, max = 300): readonly LogEvent[] => {
    const next = [...log, event];
    return next.length > max ? next.slice(next.length - max) : next;
};

// backgroundPass: after a background period the page must report a running context again with the audio clock moved on
// (a suspended context that resumes without a tap is a pass; one that stays suspended is a fail).
export function judge(args: { readonly pads: readonly PadSample[]; readonly maxSeconds: number; readonly kills: number; readonly backgroundOk: boolean | null }): Verdict {
    const padMedianMs = median(args.pads.map(softwareMs));
    return {
        padMedianMs,
        padPass: padMedianMs === null ? null : padMedianMs < B1_MAX_PAD_MS,
        playedSeconds: args.maxSeconds,
        playPass: args.maxSeconds >= B1_PLAY_SECONDS,
        kills: args.kills,
        killPass: args.kills === 0,
        backgroundPass: args.backgroundOk,
    };
}

export function buildReport(args: { readonly device: string; readonly verdict: Verdict; readonly pads: readonly PadSample[]; readonly peakHeapMb: number | null; readonly log: readonly LogEvent[]; readonly caps: unknown }): string {
    const v = args.verdict;
    const lines = [
        'B1 beat engine web view report',
        `device: ${args.device}`,
        `pad software latency median ms: ${v.padMedianMs === null ? 'n/a' : v.padMedianMs.toFixed(1)} over ${args.pads.length} hits (pass under ${B1_MAX_PAD_MS}; speaker path NOT included)`,
        `longest 8-track run seconds: ${v.playedSeconds} (pass at ${B1_PLAY_SECONDS})`,
        `web view kills: ${v.kills}`,
        `survived background: ${v.backgroundPass === null ? 'not tried' : v.backgroundPass ? 'yes' : 'NO'}`,
        `peak JS heap MB: ${args.peakHeapMb === null ? 'not reported' : args.peakHeapMb}`,
        `capabilities: ${JSON.stringify(args.caps)}`,
        '',
        'events:',
    ];
    for (const e of args.log) lines.push(`${new Date(e.at).toISOString().slice(11, 23)} ${e.kind}${e.detail ? ` ${e.detail}` : ''}`);
    return lines.join('\n');
}
