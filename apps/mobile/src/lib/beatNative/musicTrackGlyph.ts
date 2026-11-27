import type { BeatTrackDoc } from './doc';
// The Music Editor and the Instruments page intentionally share one catalogue.
// @ts-ignore plain shared JS module
import * as instruments from '../../../../../lib/musicInstruments.js';

const catalogue = instruments as unknown as { INSTRUMENTS: Record<string, { glyph: string; label: string }> };

export function musicTrackGlyph(track: BeatTrackDoc): string {
    if (track.kind === 'audio') return '🎵';
    if (!track.kind || track.kind === 'drums') return catalogue.INSTRUMENTS.drums?.glyph ?? '🥁';
    const id = (track as BeatTrackDoc & { instrument?: { id?: string } }).instrument?.id ?? 'piano';
    return catalogue.INSTRUMENTS[id]?.glyph ?? '🎹';
}
