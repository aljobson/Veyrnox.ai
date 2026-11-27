import { musicInstrumentIcon, musicTrackGlyph, musicTrackIcon } from '../src/lib/beatNative/musicTrackGlyph';
import type { BeatTrackDoc } from '../src/lib/beatNative/doc';
import { INSTRUMENT_GROUPS } from '../src/lib/beatNative/midi';

const track = (kind: BeatTrackDoc['kind'], instrument?: string) => ({
    id: 'track', name: 'Track', kind, instrument: instrument ? { id: instrument } : undefined,
    mute: false, solo: false, gain: 1, pan: 0, regions: [],
}) as BeatTrackDoc;

test('uses the shared Veyrnox instrument catalogue for timeline track icons', () => {
    expect(musicTrackGlyph(track('audio'))).toBe('🎵');
    expect(musicTrackGlyph(track('drums'))).toBe('🥁');
    expect(musicTrackGlyph(track('midi', 'guitar'))).toBe('🎸');
    expect(musicTrackGlyph(track('midi', 'bass'))).toBe('🪕');
    expect(musicTrackGlyph(track('midi', 'synth'))).toBe('🎛️');
    expect(musicTrackGlyph(track('midi', 'unknown'))).toBe('🎹');
});

test('every instrument family uses the same semantic icon in the tray and timeline', () => {
    const expected = { drums: 'drum', piano: 'pianoKeys', guitar: 'guitar', bass: 'guitar', synth: 'keyboard', wavetable: 'waveSine' } as const;
    expect(INSTRUMENT_GROUPS.map(group => group.id)).toEqual(Object.keys(expected));
    for (const group of INSTRUMENT_GROUPS) {
        expect(musicInstrumentIcon(group.id)).toBe(expected[group.id as keyof typeof expected]);
        expect(musicTrackIcon(track('midi', group.id))).toBe(expected[group.id as keyof typeof expected]);
    }
});
