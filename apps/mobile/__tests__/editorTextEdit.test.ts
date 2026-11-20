import { textStyleEdit, typographyEdit, titlePresetInsert, animationApply, animationReset, mergedTextStyle } from '../src/lib/editorTextEdit';
import { webSequenceV3 } from './fixtures/webSequenceV3';
import { TEXT_DEFAULTS, validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { TEXT_EXTRAS } from '../../../app/veyrnox/_lib/editorTextStyle.mjs';
import { updateSequenceClip } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { TITLE_STYLES, insertTitlePreset } from '../../../app/veyrnox/_lib/editorPresets.mjs';
import { applyAnimationCatalog, resetAnimationCatalog } from '../../../app/veyrnox/_lib/editorAnimationCatalog.mjs';
import type { Timeline } from '../src/lib/nativeEditorModel';
const sel = { track: 'text', id: 't3' } as const;
function same(result: ReturnType<typeof textStyleEdit>, web: unknown) {
    expect(result).toEqual({ timeline: web });
    if ('timeline' in result) expect(validateSequence(result.timeline)).toBeNull();
}
test('core edits use only web defaults; typography adds every extra', () => {
    const tl = webSequenceV3(); delete tl.text[0].style;
    const core = textStyleEdit(tl, sel, 'color', '#ff8bd1');
    same(core, updateSequenceClip(tl, 'text', 't3', { style: { ...TEXT_DEFAULTS, color: '#ff8bd1' } }));
    if (!('timeline' in core)) throw Error('refused');
    expect(Object.keys(core.timeline.text[0].style!).sort()).toEqual(Object.keys(TEXT_DEFAULTS).sort());
    const next = typographyEdit(core.timeline, sel, 'italic', true);
    same(next, updateSequenceClip(core.timeline, 'text', 't3', { style: { ...TEXT_EXTRAS, ...core.timeline.text[0].style, italic: true } }));
    if ('timeline' in next) expect(Object.keys(next.timeline.text[0].style!).sort()).toEqual([...Object.keys(TEXT_DEFAULTS), ...Object.keys(TEXT_EXTRAS)].sort());
    expect(mergedTextStyle(tl.text[0])).toEqual({ ...TEXT_DEFAULTS, ...TEXT_EXTRAS });
});
test.each(Object.keys(TEXT_DEFAULTS) as (keyof typeof TEXT_DEFAULTS)[])('core %s preserves extras and follows web merge', key => {
    const tl = webSequenceV3();
    same(textStyleEdit(tl, sel, key as keyof typeof TEXT_DEFAULTS, TEXT_DEFAULTS[key]),
        updateSequenceClip(tl, 'text', 't3', { style: { ...TEXT_DEFAULTS, ...tl.text[0].style, [key]: TEXT_DEFAULTS[key] } }));
});
test.each(Object.keys(TEXT_EXTRAS) as (keyof typeof TEXT_EXTRAS)[])('extra %s follows web merge on style-less text', key => {
    const tl = webSequenceV3(); delete tl.text[0].style;
    same(typographyEdit(tl, sel, key as keyof typeof TEXT_EXTRAS, TEXT_EXTRAS[key]),
        updateSequenceClip(tl, 'text', 't3', { style: { ...TEXT_EXTRAS, ...TEXT_DEFAULTS, [key]: TEXT_EXTRAS[key] } }));
});
test.each(TITLE_STYLES.map(p => p.name))('preset %s equals the English web path', name => {
    const tl = webSequenceV3(), sample = name === 'Lower third' ? 'Name\nYour role' : 'Your title';
    const web = insertTitlePreset(tl, name, 40);
    same(titlePresetInsert(tl, name, 40, sample), updateSequenceClip(web, 'text', `t${web.seq}`, { text: sample }));
    expect(titlePresetInsert(tl, name, 40, sample)).toEqual({ timeline: web });
});
test('preset localizes sample, clamps final frame and uses first unlocked text lane', () => {
    const tl = webSequenceV3(); tl.tracks.find(t => t.kind === 'text')!.locked = true;
    tl.tracks.push({ id: 'text-1', kind: 'text', name: 'Text 2', locked: false, hidden: false, muted: false });
    const web = insertTitlePreset(tl, 'Lower third', 18000);
    same(titlePresetInsert(tl, 'Lower third', 18000, 'Nom\nVotre rôle'), updateSequenceClip(web, 'text', `t${web.seq}`, { text: 'Nom\nVotre rôle' }));
});
test('animation apply preserves channels, restarts trimmed spans; reset equals web', () => {
    const tl = webSequenceV3(), opts = { period: 120, amount: .8, restart: true };
    same(animationApply(tl, sel, 'loop', 'pulse', opts), applyAnimationCatalog(tl, sel, 'loop', 'pulse', opts));
    const result = animationApply(tl, sel, 'loop', 'pulse', opts);
    if ('timeline' in result) expect(result.timeline.text[0].animation).toEqual({ ...tl.text[0].animation, combo: 'pulse', period: opts.period, amount: opts.amount, offset: 0, span: tl.text[0].len });
    same(animationApply(tl, { track: 'video', id: 'v1' }, 'in', 'wipe-up', { duration: 120 }),
        applyAnimationCatalog(tl, { track: 'video', id: 'v1' }, 'in', 'wipe-up', { duration: 120 }));
    same(animationReset(tl, sel), resetAnimationCatalog(tl, sel));
});
test('refusals leave input untouched', () => {
    const tl = webSequenceV3(), locked = webSequenceV3(); locked.tracks.find(t => t.kind === 'text')!.locked = true;
    const invalid = { ...tl, fps: 0 } as Timeline;
    const cases: [Timeline, () => unknown, string][] = [
        [locked, () => textStyleEdit(locked, sel, 'weight', 'normal'), 'locked'],
        [locked, () => titlePresetInsert(locked, 'Retro pop', 0, 'Your title'), 'locked'],
        [locked, () => animationApply(locked, sel, 'in', 'fade', {}), 'locked'],
        [tl, () => animationApply(tl, { track: 'audio', id: 'a1' }, 'in', 'fade', {}), 'select'],
        [tl, () => animationReset(tl, null), 'select'],
        [tl, () => typographyEdit(tl, sel, 'shadowX', 51), 'invalid'],
        [invalid, () => animationApply(invalid, sel, 'in', 'fade', {}), 'invalid'],
        [tl, () => titlePresetInsert(tl, 'missing', 0, 'Your title'), 'invalid'],
        [tl, () => textStyleEdit(tl, null, 'weight', 'normal'), 'select'],
    ];
    for (const [input, run, reason] of cases) { const before = JSON.stringify(input); expect(run()).toEqual({ refused: reason }); expect(JSON.stringify(input)).toBe(before); }
});
