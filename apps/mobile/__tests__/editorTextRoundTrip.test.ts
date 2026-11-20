import { textStyleEdit, typographyEdit, titlePresetInsert, animationApply, animationReset, type TextEditResult } from '../src/lib/editorTextEdit';
import { timelineOf, type Timeline } from '../src/lib/nativeEditorModel';
import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
import { TEXT_DEFAULTS, validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { TEXT_EXTRAS } from '../../../app/veyrnox/_lib/editorTextStyle.mjs';
import { updateSequenceClip } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { insertTitlePreset } from '../../../app/veyrnox/_lib/editorPresets.mjs';
import { applyAnimationCatalog, resetAnimationCatalog } from '../../../app/veyrnox/_lib/editorAnimationCatalog.mjs';
import { exportCopy } from '../src/lib/editorServerExport';
import { exportRefusal } from '../src/lib/editorExportRefusal';
import { utf8Bytes } from '../src/lib/editorBridge';
function accepted(result: TextEditResult) { if ('refused' in result) throw Error(result.refused); return result.timeline; }
test('a mixed web document survives the complete native edit chain and export copy', () => {
    const fixture = webSequenceV3();
    fixture.text.push({ id: 't4', text: 'Plain', start: 120, len: 90, x: .5, y: .5, size: 6, trackId: 'text-0' },
        { id: 't5', text: 'Styled', start: 240, len: 90, x: .5, y: .5, size: 7, trackId: 'text-0', style: { ...TEXT_DEFAULTS, ...TEXT_EXTRAS } },
        { id: 't6', text: 'Motion', start: 340, len: 90, x: .5, y: .5, size: 8, trackId: 'text-0', animation: { ...fixture.text[0].animation } });
    const original = JSON.stringify(fixture); let native = timelineOf(fixture), web: any = fixture;
    const selection = { track: 'text', id: 't4' } as const;
    const check = () => {
        expect(native).toEqual(web); expect(validateSequence(native)).toBeNull();
        expect(utf8Bytes(JSON.stringify(envelope(native)))).toBeLessThanOrEqual(32768);
        for (const kind of ['video', 'audio', 'text'] as const) for (const old of fixture[kind]) {
            const item = native[kind].find(c => c.id === old.id)!;
            expect([item.start, item.len, item.words]).toEqual([old.start, old.len, old.words]);
        }
        expect(native.video[1]).toEqual(fixture.video[1]); expect(native.text.slice(2, 4)).toEqual(fixture.text.slice(2, 4));
    };
    check();
    native = accepted(textStyleEdit(native, selection, 'color', '#32d6c5'));
    web = updateSequenceClip(web, 'text', 't4', { style: { ...TEXT_DEFAULTS, color: '#32d6c5' } }); check();
    native = accepted(typographyEdit(native, selection, 'shadowOpacity', .7));
    web = updateSequenceClip(web, 'text', 't4', { style: { ...TEXT_EXTRAS, ...web.text[1].style, shadowOpacity: .7 } }); check();
    native = accepted(textStyleEdit(native, selection, 'font', 'Impact'));
    web = updateSequenceClip(web, 'text', 't4', { style: { ...TEXT_DEFAULTS, ...web.text[1].style, font: 'Impact' } }); check();
    native = accepted(titlePresetInsert(native, 'Retro pop', 40, 'Your title'));
    web = insertTitlePreset(web, 'Retro pop', 40); web = updateSequenceClip(web, 'text', `t${web.seq}`, { text: 'Your title' }); check();
    const title = { track: 'text', id: `t${native.seq}` } as const, opts = { restart: true };
    native = accepted(animationApply(native, title, 'loop', 'float', opts)); web = applyAnimationCatalog(web, title, 'loop', 'float', opts); check();
    const video = { track: 'video', id: 'v1' } as const;
    native = accepted(animationApply(native, video, 'in', 'wipe-up', {})); web = applyAnimationCatalog(web, video, 'in', 'wipe-up', {}); check();
    const caption = { track: 'text', id: 't3' } as const;
    native = accepted(animationReset(native, caption)); web = resetAnimationCatalog(web, caption); check();
    const exported = exportCopy(envelope(native), {}).document.timeline as Timeline;
    expect(exported.text).toEqual(native.text);
    expect(exportRefusal('text.style')).toBe("Phone export can't include text styling yet.");
    expect(exportRefusal('text.animation')).toBe("Phone export can't include animation yet.");
    expect(JSON.stringify(fixture)).toBe(original);
});
