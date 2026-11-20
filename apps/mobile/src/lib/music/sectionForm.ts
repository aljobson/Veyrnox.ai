import { isRecord, isFiniteNumber } from '../responseShapes';
import { MUSIC_REPLACE_DURATION_MAX } from './shared';
import type { SectionActionKind } from './sectionActionTypes';
export function sectionParameters(kind: SectionActionKind, input?: Readonly<Record<string, unknown>>): Record<string, unknown> {
    return kind === 'add_section' ? { position: 'end', duration_seconds: 10, styles: '', lyrics: '', ...input }
        : { prompt: '', start_half: 0, end_half: 2, ...input };
}
export function replaceRange(parameters: Readonly<Record<string, unknown>>) {
    return { start_seconds: Number(parameters.start_half ?? 0) / 2, end_seconds: Number(parameters.end_half ?? 2) / 2 };
}
export function sourceRangeHint(seconds: unknown): number {
    return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
        ? Math.min(MUSIC_REPLACE_DURATION_MAX * 2, Math.floor(seconds * 2)) : MUSIC_REPLACE_DURATION_MAX * 2;
}

export function knownSourceDuration(song: unknown): number | undefined {
    return isRecord(song) && isFiniteNumber(song.duration_seconds) && song.duration_seconds >= 0 ? song.duration_seconds : undefined;
}
