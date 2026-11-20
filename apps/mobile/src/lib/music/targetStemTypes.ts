import type { MusicActionQuote, StemRequest, StemStart } from './actionTypes';
import type { TargetStemInstrument } from './shared';
export type TargetStemKind = 'target' | 'residual';
export type MusicTargetStemQuote = MusicActionQuote & Readonly<{
    instrument: TargetStemInstrument; source_duration_seconds: number; outputs: readonly TargetStemKind[];
}>;
export type TargetStemStart = Omit<StemStart, 'state'> & Readonly<{ state: StemRequest['state'] }>;
export type TargetStemRequest = Omit<StemRequest, 'archive_url'> & Readonly<{
    instrument: TargetStemInstrument; outputs: readonly TargetStemKind[];
}>;
export type TargetStemAsset = Readonly<{
    url: string; mime_type: string; size_bytes: number; expires_in: number; kind: TargetStemKind;
}>;
