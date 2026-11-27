import { musicTrackGlyph } from '../src/lib/beatNative/musicTrackGlyph';
import type { BeatTrackDoc } from '../src/lib/beatNative/doc';

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
