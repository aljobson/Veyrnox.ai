import { upgradeSequence, splitSequenceClip } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { timelineOf, framesIn, splitClip, validCustomFonts } from '../src/lib/nativeEditorModel';
import { moveItems } from '../src/lib/editorTimeline';
import { utf8Bytes } from '../src/lib/editorBridge';
import { webSequenceV2 } from './fixtures/webSequenceV2';
import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
test('v2 positions, lengths, transitions and tracks match web upgrade before and after an edit', () => {
    const raw = webSequenceV2(), expected = timelineOf(upgradeSequence(raw)), actual = timelineOf(raw);
    expect(validateSequence(actual)).toBeNull(); expect(actual).toEqual(expected); expect(framesIn(actual)).toBe(195);
    const selection = { track: 'video' as const, id: 'v1' };
    expect(moveItems(actual, [selection], selection, 10, undefined, false, 0)).toEqual(moveItems(expected, [selection], selection, 10, undefined, false, 0));
    expect(splitClip(actual, selection, 30)).toEqual(splitSequenceClip(expected, 'video', 'v1', 30));
});
test('v3 survives native move, split, serialization and validation with every advanced field', () => {
    const raw = webSequenceV3(); expect(validateSequence(raw)).toBeNull(); expect(utf8Bytes(JSON.stringify(envelope(raw)))).toBeLessThan(32768);
    const tl = timelineOf(raw); expect(tl).toEqual(raw);
    const selection = { track: 'video' as const, id: 'v2' };
    const moved = moveItems(tl, [selection], selection, 10, undefined, false, 0)!;
    expect(moved).toEqual({ ...raw, video: [raw.video[0], { ...raw.video[1], start: 160 }] }); expect(framesIn(moved)).toBe(250);
    for (const selection of [{ track: 'video' as const, id: 'v1' }, { track: 'text' as const, id: 't3' }]) {
        const split = splitClip(tl, selection, 30)!;
        expect(split).toEqual(splitSequenceClip(raw, selection.track, selection.id, 30));
        expect(validateSequence(JSON.parse(JSON.stringify(envelope(split))).timeline)).toBeNull(); expect(framesIn(split)).toBe(240);
    }
});
test('solo is retained only when boolean; starter tracks remain key-exact', () => {
    for (const solo of [true, false, undefined, 'yes']) {
        const raw = webSequenceV3(); Object.assign(raw.tracks[0], { solo });
        const track = timelineOf(raw).tracks[0];
        if (typeof solo === 'boolean') expect(track).toHaveProperty('solo', solo);
        else expect(track).not.toHaveProperty('solo');
    }
    expect(Object.keys(timelineOf(undefined).tracks[0]).sort()).toEqual(['id', 'kind', 'name', 'locked', 'muted', 'hidden'].sort());
});
test('incomplete legacy input still falls back to an empty native timeline', () => {
    expect(timelineOf({ schemaVersion: 2 })).toEqual(timelineOf(undefined));
});
test('custom font declarations and their text references survive native normalization and JSON round-trip', () => {
    const raw = webSequenceV3(), font = raw.fonts![0];
    raw.text[0] = { ...raw.text[0], style: { ...raw.text[0].style, font: font.family } };
    const normalized = timelineOf(raw), serialized = JSON.parse(JSON.stringify(normalized));
    expect(normalized.fonts).toEqual([font]); expect(normalized.text[0].style?.font).toBe(font.family);
    expect(serialized.fonts).toEqual([font]); expect(timelineOf(serialized)).toEqual(normalized);
    expect(validateSequence(serialized)).toBeNull(); expect(utf8Bytes(JSON.stringify(envelope(serialized)))).toBeLessThanOrEqual(32768);
});
test('an absent font declaration stays absent', () => {
    const raw = webSequenceV3() as unknown as Record<string, unknown>;
    delete raw.fonts;
    expect(timelineOf(raw).fonts).toBeUndefined();
});
test.each([null, 'font', { family: `VXFont_${'a'.repeat(64)}` }])('malformed font declarations round-trip without entering the native UI: %p', fonts => {
    const raw = webSequenceV3() as unknown as Record<string, unknown>; raw.fonts = fonts;
    const normalized = timelineOf(raw); expect((normalized as unknown as Record<string, unknown>).fonts).toEqual(fonts); expect(validCustomFonts(normalized)).toEqual([]);
});
test('malformed font array entries round-trip but are excluded from the native UI view', () => {
    const raw = webSequenceV3() as unknown as Record<string, unknown>, malformed = [null, { family: 'not-a-font' }]; raw.fonts = malformed;
    const normalized = timelineOf(raw);
    expect(normalized.fonts).toEqual(malformed); expect(JSON.parse(JSON.stringify(normalized)).fonts).toEqual(malformed);
    expect(validCustomFonts(normalized)).toEqual([]);
});
