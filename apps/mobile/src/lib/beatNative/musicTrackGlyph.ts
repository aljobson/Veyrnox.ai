import type { BeatTrackDoc } from './doc';
import type { MenuIcon } from '../menuIcons';
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

export function musicTrackIcon(track: BeatTrackDoc): MenuIcon {
    if (track.kind === 'audio') return 'audio';
    if (!track.kind || track.kind === 'drums') return 'drum';
    const id = (track as BeatTrackDoc & { instrument?: { id?: string } }).instrument?.id ?? 'piano';
    return musicInstrumentIcon(id);
}

export function musicInstrumentIcon(id: string): MenuIcon {
    if (id === 'drums') return 'drum';
    if (id === 'guitar' || id === 'bass') return 'guitar';
    if (id === 'synth') return 'keyboard';
    if (id === 'wavetable') return 'waveSine';
    return 'pianoKeys';
}
