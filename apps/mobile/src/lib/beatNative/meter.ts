import type { BeatAudio } from './audio';
import { t } from '../i18n';

export function peakDb(samples: ArrayLike<number>): number {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) if (Number.isFinite(samples[i])) peak = Math.max(peak, Math.abs(samples[i]));
    return Math.max(-60, Math.min(0, 20 * Math.log10(peak)));
}
export const meterText = (db: number): string => t('beatMix.meter.value', { value: db <= -60 ? '−∞' : db.toFixed(1) });

type Analyser = { fftSize: number; getFloatTimeDomainData(samples: Float32Array): void; disconnect(): void };
type Tap = { connect(node: unknown): unknown; disconnect(node: unknown): void };
type Reader = { audio: BeatAudio | null; trackId: string; reduced: boolean; onRead(db: number): void;
    tap?: Tap; analyser?: Analyser; samples: Float32Array };
const readers = new Set<Reader>();
let timer: ReturnType<typeof setInterval> | null = null;
let interval = 0;
function disconnect(reader: Reader) {
    if (reader.analyser) {
        try { reader.tap?.disconnect(reader.analyser); } catch { /* The retiring run may already be disconnected. */ }
        try { reader.analyser.disconnect(); } catch { /* Native node already released. */ }
    }
    reader.analyser = undefined; reader.tap = undefined;
}
function read(reader: Reader) {
    let db = -60;
    try {
        const tap = reader.audio?.meterTap(reader.trackId) as Tap | null;
        if (tap !== (reader.tap ?? null)) {
            disconnect(reader);
            reader.tap = tap ?? undefined;
            const context = reader.audio?.context;
            if (tap && typeof context?.createAnalyser === 'function') {
                const analyser = context.createAnalyser() as Analyser;
                reader.analyser = analyser; analyser.fftSize = 256;
                tap.connect(analyser);
            }
        }
        if (reader.analyser) { reader.analyser.getFloatTimeDomainData(reader.samples); db = peakDb(reader.samples); }
    } catch { disconnect(reader); }
    reader.onRead(db);
}
function updateLoop() {
    const ms = readers.size ? ([...readers].every(r => r.reduced) ? 250 : 1000 / 15) : 0;
    if (ms === interval) return;
    if (timer !== null) clearInterval(timer);
    interval = ms;
    timer = ms ? setInterval(() => { for (const reader of readers) read(reader); }, ms) : null;
}
/** All mounted meters share one clock. A run/tap change is detected on its next reading. */
export function subscribeMeter(audio: BeatAudio | null, trackId: string, reduced: boolean, onRead: (db: number) => void): () => void {
    const reader: Reader = { audio, trackId, reduced, onRead, samples: new Float32Array(256) };
    readers.add(reader); read(reader); updateLoop();
    return () => { disconnect(reader); readers.delete(reader); updateLoop(); };
}
