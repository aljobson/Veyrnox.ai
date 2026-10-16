import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptions, insertCaptions, exportCaptions, cutSequenceRange } from '../app/veyrnox/_lib/editorCaptions.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip, updateSequenceTrack } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { evaluatedTransform } from '../app/veyrnox/_lib/editorSequenceRender.mjs';
test('SRT and VTT timings round-trip within one frame; multiline text stays literal', () => {
    const parsed = parseCaptions('1\n00:00:01,033 --> 00:00:02,100\nHello\nWorld\n');
    assert.deepEqual(parsed.cues, [{ text: 'Hello\nWorld', start: 31, len: 32 }]);
    const tl = insertCaptions(emptySequence(), parsed.cues); assert.equal(validateSequence(tl), null);
    assert.deepEqual(parseCaptions(exportCaptions(tl), 'srt').cues, parsed.cues);
    assert.deepEqual(parseCaptions(exportCaptions(tl, 'vtt'), 'vtt').cues, parsed.cues);
});
test('ASS follows its declared field order, preserves commas and strips override tags; LRC derives bounded end times', () => {
    const parsed = parseCaptions('[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:01.50,Default,,0,0,0,,Hello, world\\N{\\b1}Second', 'ass');
    assert.deepEqual(parsed.cues, [{ text: 'Hello, world\nSecond', start: 0, len: 45 }]);
    assert.deepEqual(parseCaptions('[00:01.00]One\n[00:02.50]Two', 'lrc').cues, [{ text: 'One', start: 30, len: 45 }, { text: 'Two', start: 75, len: 90 }]);
});
test('caption cleanup removes malformed and nested HTML delimiters completely', () => {
    const parsed = parseCaptions('1\n00:00:00,000 --> 00:00:01,000\n<<script>alert(1)</script><b>safe</b>');
    assert.equal(parsed.cues[0].text, 'alert(1)safe');
    assert.doesNotMatch(parsed.cues[0].text, /[<>]/);
});
test('malformed times, inverted intervals, oversized files and out-of-range captions fail before insertion', () => {
    for (const source of ['1\n00:00:02,000 --> 00:00:01,000\nWrong', '1\n00:99:00,000 --> 00:99:01,000\nBad', '1\n00:10:00,000 --> 00:10:01,000\nToo late', 'x'.repeat(262145)]) assert.ok(parseCaptions(source).error);
});
test('a transcript range cut preserves source alignment across retimed video/audio and shifts later captions atomically', () => {
    const media = { id: 'l-source', kind: 'video', frames: 600, width: 1280, height: 720, name: 'source', hasAudio: true };
    let tl = addSequenceMedia(emptySequence(), media); tl = addSequenceClip(tl, 'video', media.id, { len: 120, rate: 2 }); tl = addSequenceClip(tl, 'audio', media.id, { len: 120 }); tl = insertCaptions(tl, [{ text: 'Cut', start: 30, len: 30 }, { text: 'Keep', start: 90, len: 30 }]);
    const cut = cutSequenceRange(tl, 30, 60); assert.equal(validateSequence(cut), null);
    assert.deepEqual(cut.video.map(c => [c.start, c.len, c.in]), [[0, 30, 0], [30, 60, 120]]);
    assert.deepEqual(cut.audio.map(c => [c.start, c.len, c.in]), [[0, 30, 0], [30, 60, 60]]);
    assert.equal(cut.text.length, 1); assert.equal(cut.text[0].start, 60);
    const locked = updateSequenceTrack(tl, 'audio-0', { locked: true }); assert.match(cutSequenceRange(locked, 30, 60).error, /Unlock/); assert.equal(tl.video.length, 1);
});
test('keyframes interpolate position, scale and opacity with declared easing; animations agree at boundaries', () => {
    const clip = { len: 120, keyframes: [{ frame: 0, x: 0, y: 0.5, scale: 1, rotation: 0, opacity: 0, easing: 'linear' }, { frame: 60, x: 1, y: 0.5, scale: 2, rotation: 90, opacity: 1, easing: 'linear' }] };
    const mid = evaluatedTransform(clip, 30); assert.equal(mid.x, 0.5); assert.equal(mid.scale, 1.5); assert.equal(mid.opacity, 0.5); assert.equal(mid.rotation, 45);
    assert.equal(evaluatedTransform({ len: 60, animation: { in: 'fade', out: 'fade', duration: 15 } }, 0).opacity, 0);
    assert.equal(evaluatedTransform({ len: 60, animation: { in: 'fade', out: 'fade', duration: 15 } }, 30).opacity, 1);
});
