import { laneRevealScrollY, measureAndRevealLane, searchClips } from '../src/lib/beatNative/arrange';
import { addAudioRegion, createBeat, validateBeat, type BeatDoc } from '../src/lib/beatNative/doc';

function searchDoc(): BeatDoc {
    const base = createBeat({ id: '00000000-0000-4000-8000-000000000001', title: 'Search', now: 1 });
    base.tracks[0].name = 'Main Drums';
    const audio = addAudioRegion(base, {
        source: 'take', ref: 'clip-search-take', name: 'Lead Voice', durationSec: 4,
        bpm: null, sourceChannels: 1, encodedBytes: 0,
    }, null, 4 * 3840);
    const fixture = {
        ...audio,
        clips: { c1: { name: 'Warm Bass', lengthTicks: 3840, notes: [] } },
        tracks: [...audio.tracks, {
            id: 'tm', name: 'Keys Track', kind: 'midi' as const,
            instrument: { engine: 'voice', id: 'synth', preset: 'pad' },
            gain: 1, pan: 0, mute: false, solo: false,
            regions: [{ id: 'rm', start: 8 * 3840, length: 3840, clipId: 'c1', phaseTicks: 0 }],
        }],
    } as BeatDoc;
    expect(validateBeat(fixture).ok).toBe(true);
    return fixture;
}

test('shared clip search keeps blank, case, source-label, drum and document-order parity', () => {
    const doc = searchDoc();
    expect(searchClips(doc, '')).toEqual([]);
    expect(searchClips(doc, '  ')).toEqual([]);
    expect(searchClips(doc, 'MAIN DRUMS')).toEqual([{ trackId: 't1', regionId: 'r1', label: 'Main Drums' }]);
    expect(searchClips(doc, 'lead VOICE')).toEqual([{ trackId: doc.tracks[1].id, regionId: doc.tracks[1].regions[0].id, label: 'Lead Voice' }]);
    expect(searchClips(doc, 'warm BASS')).toEqual([{ trackId: 'tm', regionId: 'rm', label: 'Warm Bass' }]);
    expect(searchClips(doc, 'keys track')).toEqual([{ trackId: 'tm', regionId: 'rm', label: 'Warm Bass' }]);
    const patternOnly = structuredClone(doc);
    patternOnly.tracks[0].name = 'Drums'; patternOnly.tracks[1].name = 'Voice'; patternOnly.tracks[2].name = 'Keys';
    patternOnly.assets![patternOnly.tracks[1].regions[0].assetId!].name = 'Voice'; patternOnly.clips!.c1.name = 'Sub';
    // Drum pattern slot letters are not searchable labels.
    expect(searchClips(patternOnly, 'A')).toEqual([]);
    expect(searchClips(doc, 'track').map(result => result.trackId)).toEqual(['tm']);
});

test('lane reveal converts fresh window geometry, existing scroll and preceding content into a clamped destination', () => {
    expect(laneRevealScrollY({ currentScrollY: 320, laneWindowY: 600, workspaceWindowY: 120,
        contentHeight: 2000, viewportHeight: 600, inset: 16 })).toBe(784);
    expect(laneRevealScrollY({ currentScrollY: 20, laneWindowY: 50, workspaceWindowY: 100,
        contentHeight: 2000, viewportHeight: 600, inset: 16 })).toBe(0);
    expect(laneRevealScrollY({ currentScrollY: 1000, laneWindowY: 800, workspaceWindowY: 100,
        contentHeight: 1700, viewportHeight: 500, inset: 16 })).toBe(1200);
    expect(laneRevealScrollY({ currentScrollY: 0, laneWindowY: 100, workspaceWindowY: 0,
        contentHeight: 0, viewportHeight: 500, inset: 16 })).toBeNull();
});

test('window coordinates stay invariant through regular-width wrapper reflow and invalid measurements no-op', () => {
    const phone = laneRevealScrollY({ currentScrollY: 400, laneWindowY: 650, workspaceWindowY: 200,
        contentHeight: 2400, viewportHeight: 700, inset: 16 });
    const regularAfterReflow = laneRevealScrollY({ currentScrollY: 400, laneWindowY: 500, workspaceWindowY: 50,
        contentHeight: 2400, viewportHeight: 700, inset: 16 });
    expect(phone).toBe(834); expect(regularAfterReflow).toBe(phone);
    const base = { currentScrollY: 0, laneWindowY: 100, workspaceWindowY: 0, contentHeight: 1000, viewportHeight: 500 };
    expect(laneRevealScrollY({ ...base, laneWindowY: Number.NaN })).toBeNull();
    expect(laneRevealScrollY({ ...base, viewportHeight: 0 })).toBeNull();
    expect(laneRevealScrollY({ ...base, inset: -1 })).toBeNull();
});

test('lane reveal measures both native refs fresh and uses non-zero scroll, preceding content and reflow height', () => {
    const reveal = jest.fn();
    const lane = { measureInWindow: jest.fn((callback: Function) => callback(0, 600, 400, 96)) };
    const workspace = { measureInWindow: jest.fn((callback: Function) => callback(0, 120, 400, 600)) };
    measureAndRevealLane({ lane, workspace, currentScrollY: 320, contentHeight: 2000,
        viewportHeight: 999, inset: 16, isCurrent: () => true, onReveal: reveal });
    expect(lane.measureInWindow).toHaveBeenCalledTimes(1);
    expect(workspace.measureInWindow).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledWith(784);

    lane.measureInWindow.mockImplementationOnce((callback: Function) => callback(0, 500, 400, 96));
    workspace.measureInWindow.mockImplementationOnce((callback: Function) => callback(0, 50, 400, 700));
    measureAndRevealLane({ lane, workspace, currentScrollY: 400, contentHeight: 2400,
        viewportHeight: 999, inset: 16, isCurrent: () => true, onReveal: reveal });
    expect(reveal).toHaveBeenLastCalledWith(834);
});

test('lane reveal is a safe no-op for unavailable, invalid, thrown, or superseded measurement', () => {
    const reveal = jest.fn();
    const valid = { measureInWindow: (callback: Function) => callback(0, 500, 400, 96) };
    const input = { currentScrollY: 100, contentHeight: 1200, viewportHeight: 500,
        isCurrent: () => true, onReveal: reveal };
    measureAndRevealLane({ ...input, lane: null, workspace: valid });
    measureAndRevealLane({ ...input, lane: {}, workspace: valid });
    measureAndRevealLane({ ...input, lane: { measureInWindow: () => { throw new Error('unmounted'); } }, workspace: valid });
    measureAndRevealLane({ ...input, lane: valid,
        workspace: { measureInWindow: (callback: Function) => callback(0, Number.NaN, 400, 500) } });
    measureAndRevealLane({ ...input, contentHeight: 0, lane: valid,
        workspace: { measureInWindow: (callback: Function) => callback(0, 100, 400, 500) } });
    expect(reveal).not.toHaveBeenCalled();

    let laneCallback: Function | undefined;
    let workspaceCallback: Function | undefined;
    let current = true;
    measureAndRevealLane({ ...input, isCurrent: () => current,
        lane: { measureInWindow: callback => { laneCallback = callback; } },
        workspace: { measureInWindow: callback => { workspaceCallback = callback; } } });
    current = false;
    laneCallback?.(0, 500, 400, 96);
    workspaceCallback?.(0, 100, 400, 500);
    expect(reveal).not.toHaveBeenCalled();
});
