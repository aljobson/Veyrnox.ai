import { clampFrame } from './editorInsertMedia';
import { SEQUENCE_MAX } from './editorTimeline';
import { formatLocale } from './i18n';
import type { Media } from './nativeEditorModel';

export const voiceoverLimitSeconds = (startFrame: number, fps: number) => Math.min(600, Math.floor((SEQUENCE_MAX - clampFrame(startFrame)) / fps));
export const meterLevel = (db?: number) => typeof db === 'number' && Number.isFinite(db) ? Math.max(0, Math.min(1, (db + 60) / 60)) : 0;
export function clock(seconds: number): string {
    const value = Math.max(0, Math.floor(seconds));
    const digits = (n: number, minimumIntegerDigits: number) => new Intl.NumberFormat(formatLocale(), { useGrouping: false, minimumIntegerDigits }).format(n);
    return `${digits(Math.floor(value / 60), 1)}:${digits(value % 60, 2)}`;
}
export function isWavHeader(bytes: Uint8Array): boolean {
    return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WAVE';
}
export const voiceoverMedia = (id: string, seconds: number, fps: number, name: string): Media => ({
    id, name: name.slice(0, 120), kind: 'audio', frames: Math.max(1, Math.floor(seconds * fps)), hasAudio: true, width: 0, height: 0,
});
