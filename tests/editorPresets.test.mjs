import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence, addSequenceMedia, addSequenceClip, addSequenceText, duplicateSequence, setSequenceTransition, updateSequenceTrack, trimSequence, splitSequenceClip, updateSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { EDIT_TEMPLATE_CATALOG, TITLE_STYLES, insertGraphic, insertEditTemplate, insertTitlePreset } from '../app/veyrnox/_lib/editorPresets.mjs';
import { SHAPES } from '../app/veyrnox/_lib/editorGraphics.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { sequenceLayers } from '../app/veyrnox/_lib/editorSequenceRender.mjs';
import { timelineSize } from '../app/veyrnox/_lib/editorRender.mjs';
import { validateExportSettings } from '../app/veyrnox/_lib/editorExportSettings.mjs';
import { EFFECT_TYPES, TRANSITION_TYPES, VIDEO_EFFECTS, TRANSITIONS } from '../app/veyrnox/_lib/editorEffects.mjs';
test('a slideshow appends after the whole sequence, preserving existing audio/text timing', () => {
    let tl = insertGraphic(emptySequence(), 'star', '#32d6c5', 0);
    tl = addSequenceText(tl, { text: 'Existing ending', start: 300, len: 90 });
    const next = insertEditTemplate(tl, 'Slideshow', ['g-1'], 'New title', 0);
    assert.equal(validateSequence(next), null); assert.equal(next.video.at(-1).start, 390); assert.equal(next.text.at(-1).start, 390);
    assert.deepEqual(next.text[0], tl.text[0]);
});
test('expanded original elements and text styles remain valid editable project content', () => {
    assert.equal(SHAPES.length, 20);assert.equal(new Set(SHAPES).size,SHAPES.length);assert.equal(TITLE_STYLES.length,16);
    for(const shape of SHAPES){const next=insertGraphic(emptySequence(),shape,'#32d6c5',0);assert.equal(validateSequence(next),null,shape);assert.equal(next.media[`g-${next.seq-1}`]?.graphic.shape,shape);}
    for(const preset of TITLE_STYLES){const next=insertTitlePreset(emptySequence(),preset.name,0);assert.equal(validateSequence(next),null,preset.name);}
});
test('professional templates add editable clips without replacing existing work',()=>{
    assert.equal(EDIT_TEMPLATE_CATALOG.length,8);
    let tl=insertGraphic(emptySequence(),'circle','#ffffff',0);const first=tl.video.at(-1).mediaId;
    tl=insertGraphic(tl,'rectangle','#32d6c5',90);const second=tl.video.at(-1).mediaId,existing=tl.video.length;
    const split=insertEditTemplate(tl,'Split screen',[first,second],'Side by side',180);
    assert.equal(validateSequence(split),null);assert.equal(split.video.length,existing+2);assert.equal(split.text.at(-1).text,'Side by side');
    const quote=insertEditTemplate(tl,'Social quote',[],'Make the cut',0);
    assert.equal(validateSequence(quote),null);assert.equal(quote.video.length,existing);assert.equal(quote.text.at(-1).style.background,'#ffe66d');
});
test('transitions require adjacency, respect locks and expose shared compositor timing', () => {
    let tl = insertGraphic(emptySequence(), 'circle', '#ffffff', 0);
    assert.match(setSequenceTransition(tl, 'v2', 'wipe-left', 15).error, /immediately/);
    tl = duplicateSequence(tl, { track: 'video', id: 'v2' }); tl = setSequenceTransition(tl, 'v3', 'wipe-left', 15);
    const layers = sequenceLayers(tl, 94); assert.equal(layers.visuals.length, 2); assert.deepEqual(layers.visuals[1].wipe, { direction: 'left', progress: 1 / 3 });
    const locked = updateSequenceTrack(tl, 'video-1', { locked: true }); assert.match(setSequenceTransition(locked, 'v3', 'zoom', 15).error, /Unlock/);
});
test('the original effects catalog is complete, unique and accepted by saved projects', () => {
    assert.equal(new Set(EFFECT_TYPES).size, EFFECT_TYPES.length);
    assert.equal(VIDEO_EFFECTS.length, 18);
    let tl = insertGraphic(emptySequence(), 'circle', '#ffffff', 0);
    for (const type of EFFECT_TYPES) {
        const next = updateSequenceClip(tl, 'video', 'v2', { effect: { type, intensity: 0.75 } });
        assert.equal(validateSequence(next), null, type);
    }
    assert.match(updateSequenceClip(tl, 'video', 'v2', { effect: { type: 'third-party-preset', intensity: 1 } }).error, /effect/i);
});
test('directional transitions expose the correct compositor geometry', () => {
    assert.equal(TRANSITIONS.length, 13);
    assert.ok(TRANSITION_TYPES.includes('slide'));
    let tl = insertGraphic(emptySequence(), 'circle', '#ffffff', 0);
    tl = duplicateSequence(tl, { track: 'video', id: 'v2' });
    for (const type of TRANSITIONS.map(item => item.id)) {
        const next = setSequenceTransition(tl, 'v3', type, 15);
        assert.equal(validateSequence(next), null, type);
        const incoming = sequenceLayers(next, 94).visuals.at(-1);
        if (type.startsWith('wipe-')) assert.equal(incoming.wipe.direction, type.slice(5));
        if (type === 'slide-left') assert.ok(incoming.slideX > 0);
        if (type === 'slide-right') assert.ok(incoming.slideX < 0);
        if (type === 'slide-up') assert.ok(incoming.slideY > 0);
        if (type === 'slide-down') assert.ok(incoming.slideY < 0);
        if (type === 'blur') assert.ok(incoming.transitionBlur > 0);
        if (type === 'flash') assert.ok(incoming.flash > 0);
    }
});
test('shortening or splitting faded clips keeps fade ranges valid', () => {
    let tl = insertGraphic(emptySequence(), 'rectangle', '#ffffff', 0); tl = updateSequenceClip(tl, 'video', 'v2', { fadeIn: 60, fadeOut: 60 });
    assert.equal(validateSequence(trimSequence(tl, 'video', 'v2', 'out', -70)), null);
    const split = splitSequenceClip(tl, 'video', 'v2', 10); assert.equal(validateSequence(split), null); assert.equal(split.video[0].fadeIn, 10);
});
test('v3 4K sizing and selected frame rates obey a bounded export memory budget', () => {
    assert.deepEqual(timelineSize(emptySequence(), 2160), { width: 3840, height: 2160 });
    assert.deepEqual(timelineSize({ ...emptySequence(), schemaVersion: 2 }, 2160), { width: 1280, height: 720 });
    assert.equal(validateExportSettings({ height: 2160, frameRate: 60, format: 'mov', quality: 'high' }, 70), null);
    assert.match(validateExportSettings({ height: 2160, frameRate: 60, format: 'mov', quality: 'high' }, 600), /memory/);
    assert.match(validateExportSettings({ height: 1080, frameRate: 0, format: 'mp4', quality: 'standard' }, 4), /valid/);
});

test('overlapping large source decoders are bounded separately from encoded output size', async () => {
    const { exportMemoryProblem } = await import('../app/veyrnox/_lib/editorExportMemory.mjs');
    const media = { id: 'large', kind: 'video', frames: 300, width: 4096, height: 4096, hasAudio: false, name: 'Large' };
    let tl = addSequenceMedia(emptySequence(), media);
    for (let i = 0; i < 5; i++) tl = addSequenceClip(tl, 'video', media.id, { start: 0, len: 90 });
    assert.match(exportMemoryProblem(tl, 720, 'compact'), /working-memory/);
    tl = { ...tl, video: tl.video.map((clip, i) => ({ ...clip, start: i * 90 })) };
    assert.equal(exportMemoryProblem(tl, 720, 'compact'), null);
});
