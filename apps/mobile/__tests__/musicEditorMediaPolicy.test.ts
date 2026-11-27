import { regionTimelineMarks } from '../src/components/beats/BeatRegionView';
import { secureRemoteSongUrl } from '../src/lib/beatNative/remoteSong';
import { MUSIC_EDITOR_COMPACT_DOCK_HEIGHT, MUSIC_EDITOR_COMPACT_TIMELINE_HEIGHT, MUSIC_EDITOR_MIN_ARRANGEMENT_HEIGHT, MUSIC_EDITOR_SHORT_LANDSCAPE_BOTTOM_INSET_BUDGET, MUSIC_EDITOR_TRANSPORT_DIVIDER_HEIGHT, musicEditorCompactsTimeline, musicTransportLayout, musicTrayMaxHeight } from '../src/lib/beatNative/editorLayout';

test('timeline texture is deterministic, region-specific and aligned to musical subdivisions', () => {
    const first = regionTimelineMarks('region-a', 1920);
    expect(first).toEqual(regionTimelineMarks('region-a', 1920));
    expect(first).not.toEqual(regionTimelineMarks('region-b', 1920));
    expect(first).toHaveLength(8);
    expect(first.map(mark => mark.tick)).toEqual([0, 240, 480, 720, 960, 1200, 1440, 1680]);
    expect(first.every(mark => mark.height >= 5 && mark.height <= 16)).toBe(true);
});

test('timeline texture stays bounded for long regions and low zoom', () => {
    expect(regionTimelineMarks('long-region', 32 * 3840, 32).length).toBeLessThanOrEqual(64);
});

test('inline trays preserve an arrangement heading, ruler, and one lane or collapse the transport', () => {
    expect(musicTrayMaxHeight(390, 844)).toBe(282);
    const landscape = musicTrayMaxHeight(844, 390);
    expect(landscape).toBe(128);
    expect(390 - 85 - landscape).toBeGreaterThanOrEqual(MUSIC_EDITOR_MIN_ARRANGEMENT_HEIGHT);

    const keyboardLandscape = musicTransportLayout(844, 390, 180);
    expect(keyboardLandscape).toEqual({ trayMaxHeight: 65, compactViewport: true });
    expect(390 - 180 - MUSIC_EDITOR_COMPACT_DOCK_HEIGHT - MUSIC_EDITOR_TRANSPORT_DIVIDER_HEIGHT - keyboardLandscape.trayMaxHeight)
        .toBeGreaterThanOrEqual(MUSIC_EDITOR_COMPACT_TIMELINE_HEIGHT);

    const measuredIphone17Landscape = musicTransportLayout(874, 193);
    expect(measuredIphone17Landscape).toEqual({ trayMaxHeight: 48, compactViewport: true });
    expect(193 - MUSIC_EDITOR_COMPACT_DOCK_HEIGHT - MUSIC_EDITOR_TRANSPORT_DIVIDER_HEIGHT - measuredIphone17Landscape.trayMaxHeight)
        .toBeGreaterThanOrEqual(MUSIC_EDITOR_COMPACT_TIMELINE_HEIGHT);

    const editingLandscape = musicTransportLayout(874, 193, 0, undefined, true);
    expect(editingLandscape).toEqual({ trayMaxHeight: 104, compactViewport: true });
    expect(193 - MUSIC_EDITOR_COMPACT_DOCK_HEIGHT - MUSIC_EDITOR_TRANSPORT_DIVIDER_HEIGHT - editingLandscape.trayMaxHeight)
        .toBeGreaterThanOrEqual(44);

    const phoneLandscapeWithInset = musicTransportLayout(874, 402, 0, undefined, false, MUSIC_EDITOR_SHORT_LANDSCAPE_BOTTOM_INSET_BUDGET);
    expect(musicEditorCompactsTimeline(874, 402, true)).toBe(true);
    expect(402 - MUSIC_EDITOR_SHORT_LANDSCAPE_BOTTOM_INSET_BUDGET - 85 - phoneLandscapeWithInset.trayMaxHeight)
        .toBeGreaterThanOrEqual(MUSIC_EDITOR_COMPACT_TIMELINE_HEIGHT);
    expect(musicEditorCompactsTimeline(874, 402, false)).toBe(false);

    const shortLandscapeTool = musicTransportLayout(874, 358, 0, undefined, false,
        MUSIC_EDITOR_SHORT_LANDSCAPE_BOTTOM_INSET_BUDGET, true);
    expect(shortLandscapeTool.compactViewport).toBe(false);
    expect(shortLandscapeTool.trayMaxHeight).toBeGreaterThanOrEqual(120);
    expect(358 - MUSIC_EDITOR_SHORT_LANDSCAPE_BOTTOM_INSET_BUDGET - 85 - shortLandscapeTool.trayMaxHeight)
        .toBeGreaterThanOrEqual(MUSIC_EDITOR_COMPACT_TIMELINE_HEIGHT);
});

test('remote song URLs stay HTTPS except for exact development loopback hosts', () => {
    expect(secureRemoteSongUrl('https://media.example.test/song.wav')).toBe('https://media.example.test/song.wav');
    expect(() => secureRemoteSongUrl('http://media.example.test/song.wav')).toThrow('invalid_signed_url');
    expect(() => secureRemoteSongUrl('http://localhost.example.test/song.wav')).toThrow('invalid_signed_url');
    expect(() => secureRemoteSongUrl('javascript:alert(1)')).toThrow('invalid_signed_url');
    if ((globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__) {
        expect(secureRemoteSongUrl('http://localhost:8799/audio.wav')).toBe('http://localhost:8799/audio.wav');
        expect(secureRemoteSongUrl('http://127.0.0.1:8799/audio.wav')).toBe('http://127.0.0.1:8799/audio.wav');
    }
});
