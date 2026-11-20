import { webSequenceV3, envelope } from './fixtures/webSequenceV3';
import { timelineOf, framesIn } from '../src/lib/nativeEditorModel';
import * as native from '../src/lib/editorCaptionEdit';
import { parseCaptions, insertCaptions, exportCaptions, applyCaptionStyle } from '../../../app/veyrnox/_lib/editorCaptions.mjs';
import { distributeWords } from '../../../app/veyrnox/_lib/editorWords.mjs';
import { updateSequenceClip } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { correctTranscriptWord, cutTranscriptRange } from '../../../app/veyrnox/_lib/editorTranscript.mjs';
import { alignLyricCaptions } from '../../../app/veyrnox/_lib/editorLyrics.mjs';
import { validateSequence, TEXT_DEFAULTS } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { documentProblem } from '../src/lib/editorDocumentGate';
import { utf8Bytes } from '../src/lib/editorBridge';
const vtt = 'WEBVTT\n\n00:00:04.000 --> 00:00:06.000\n<00:00:04.000>One <00:00:05.000>two';
const json = JSON.stringify({ words: [{ word: 'Sing', start: 8, end: 8.5 }, { word: 'now', start: 9, end: 10 },
    { word: 'Stay', start: 12, end: 12.5 }, { word: 'here', start: 13, end: 14 }] });
test('project chain matches web after every atomic edit', () => {
    let tl = timelineOf(webSequenceV3()), web: any = timelineOf(webSequenceV3());
    function step(result: native.CaptionResult, next: any) {
        expect(result).toHaveProperty('timeline'); if (!('timeline' in result)) return;
        tl = result.timeline; web = next; expect(tl).toEqual(web); expect(validateSequence(tl)).toBeNull();
        expect(utf8Bytes(JSON.stringify(envelope(tl)))).toBeLessThanOrEqual(32768); expect(framesIn(tl)).toBe(framesIn(web));
    }
    step(native.importCaptionText(tl, vtt, 'a.vtt'), insertCaptions(web, parseCaptions(vtt, 'vtt').cues));
    const first = tl.text.at(-1)!.id;
    step(native.importCaptionText(tl, json, 'a.json'), insertCaptions(web, parseCaptions(json, 'json').cues));
    const source = tl.text.at(-1)!.id, cutSource = tl.text.at(-2)!.id;
    const words = web.text.find((c: any) => c.id === 't3').words.map((w: any, i: number) => i ? { ...w, len: w.len + 3 } : w);
    step(native.wordEdit(tl, 't3', 1, 'len', words[1].len), updateSequenceClip(web, 'text', 't3', { words, wordsEstimated: true }));
    step(native.wordsDistribute(tl, first), updateSequenceClip(web, 'text', first, distributeWords(web.text.find((c: any) => c.id === first))));
    step(native.transcriptCorrect(tl, `${cutSource}:0`, 'Once'), correctTranscriptWord(web, `${cutSource}:0`, 'Once'));
    const range = { first: `${cutSource}:0`, last: `${cutSource}:1` };
    step(native.transcriptCut(tl, range, 'all'), cutTranscriptRange(web, range, 'all'));
    step(native.lyricsAlign(tl, 'Stay here', source), alignLyricCaptions(web, 'Stay here', source));
    step(native.captionStyleAll(tl, 'web'), applyCaptionStyle(web, { ...TEXT_DEFAULTS, color: '#ffe66d', backgroundOpacity: .7 }));
    for (const format of ['srt', 'vtt'] as const) expect(parseCaptions(exportCaptions(tl, format), format)).toEqual(parseCaptions(exportCaptions(web, format), format));
});
test('subtitle exports normalise word gaps and trimmed words exactly as web', () => {
    const tl = timelineOf(webSequenceV3()); tl.text = [{ ...tl.text[0], text: 'Hello world', start: 0, len: 90,
        words: [{ text: 'Hello', start: -10, len: 30 }, { text: 'world', start: 45, len: 30 }], wordsEstimated: false }];
    const parsed = parseCaptions(native.captionExport(tl, 'vtt')!.body, 'vtt');
    expect(parsed.cues![0].words).toEqual([{ text: 'Hello', start: 0, len: 45 }, { text: 'world', start: 45, len: 45 }]);
    expect(tl.text[0].words![0].start).toBe(-10);
    expect(parseCaptions(native.captionExport(tl, 'srt')!.body, 'srt').cues![0]).toMatchObject({ text: 'Hello world', start: 0, len: 90 });
});
test('early timeline and later envelope size refusals are separate and atomic', () => {
    const tl = timelineOf(webSequenceV3()), before = JSON.stringify(tl);
    const text = Array.from({ length: 150 }, (_, i) => `${i + 1}\n00:00:00,000 --> 00:00:01,000\n${'a'.repeat(200)}`).join('\n\n');
    expect(native.importCaptionText(tl, text, 'a.srt')).toEqual({ refused: { key: 'editorEditGate.tooLarge' } });
    expect(JSON.stringify(tl)).toBe(before);
    const imported = native.importCaptionText(tl, vtt, 'a.vtt'); expect(imported).toHaveProperty('timeline');
    if ('timeline' in imported) expect(documentProblem({ ...envelope(imported.timeline), brief: 'a'.repeat(32768) })).toBe('tooLarge');
});
