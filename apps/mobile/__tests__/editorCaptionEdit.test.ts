import { emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';
import { importCaptionText, captionExport, wordEdit, wordStyleEdit, wordsDistribute, wordsClear,
    transcriptCut, transcriptCorrect, lyricsAlign, captionStyleAll, CAPTION_STYLE_PRESETS, captionStylePresetId } from '../src/lib/editorCaptionEdit';
import { parseCaptions, insertCaptions, exportCaptions, applyCaptionStyle } from '../../../app/veyrnox/_lib/editorCaptions.mjs';
import { WORD_STYLE, distributeWords } from '../../../app/veyrnox/_lib/editorWords.mjs';
import { updateSequenceClip } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { cutTranscriptRange, correctTranscriptWord, transcriptText } from '../../../app/veyrnox/_lib/editorTranscript.mjs';
import { alignLyricCaptions } from '../../../app/veyrnox/_lib/editorLyrics.mjs';
import { TEXT_DEFAULTS, validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
const srt = '1\n00:00:00,000 --> 00:00:02,000\nHello world';
const json = JSON.stringify({ words: [{ word: 'Hello', start: 0, end: .5 }, { word: 'world', start: 1, end: 2 }] });
function same(result: any, web: any) { expect(result.timeline).toEqual(web); expect(validateSequence(result.timeline)).toBeNull(); }
function source(): Timeline { return insertCaptions(emptyTimeline(), parseCaptions(json, 'json').cues) as Timeline; }
test.each([
    ['srt', srt], ['VTT', 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<00:00:01.000>Hello <00:00:01.200>world'],
    ['ass', '[Events]\nFormat: Start, End, Text\nDialogue: 0:00:00.00,0:00:02.00,Hello world'],
    ['lrc', '[00:00.00]Hello world'], ['json', json],
])('imports %s exactly like web without mutation', (ext, body) => {
    const tl = emptyTimeline(), before = JSON.stringify(tl), parsed = parseCaptions(body, ext.toLowerCase());
    const result = importCaptionText(tl, body, `captions.${ext}`);
    same(result, insertCaptions(tl, parsed.cues)); expect(result).toMatchObject({ count: parsed.cues!.length });
    expect(JSON.stringify(tl)).toBe(before);
});
test('all edit wrappers match shared functions', () => {
    const tl = source(), id = tl.text[0].id, before = JSON.stringify(tl), words = tl.text[0].words!;
    same(wordEdit(tl, id, 0, 'len', 18), updateSequenceClip(tl, 'text', id, { words: [{ ...words[0], len: 18 }, words[1]], wordsEstimated: true }));
    same(wordStyleEdit(tl, id, { mode: 'karaoke' }), updateSequenceClip(tl, 'text', id, { wordStyle: { ...WORD_STYLE, mode: 'karaoke' } }));
    same(wordsDistribute(tl, id), updateSequenceClip(tl, 'text', id, distributeWords(tl.text[0])));
    same(wordsClear(tl, id), updateSequenceClip(tl, 'text', id, { words: [], wordsEstimated: true }));
    same(transcriptCorrect(tl, `${id}:0`, 'Hi'), correctTranscriptWord(tl, `${id}:0`, 'Hi'));
    const selection = { first: `${id}:0`, last: `${id}:0` };
    same(transcriptCut(tl, selection, 'all'), cutTranscriptRange(tl, selection, 'all'));
    same(lyricsAlign(tl, 'Hello world', id), alignLyricCaptions(tl, 'Hello world', id));
    same(captionStyleAll(tl, 'web'), applyCaptionStyle(tl, { ...TEXT_DEFAULTS, color: '#ffe66d', backgroundOpacity: .7 }));
    same(captionStyleAll(tl, { color: '#ffffff' }), applyCaptionStyle(tl, { ...TEXT_DEFAULTS, color: '#ffffff' }));
    expect(CAPTION_STYLE_PRESETS.map(preset => preset.id)).toEqual(['clean', 'classic', 'highlight', 'box', 'neon', 'subtitle']);
    for (const preset of CAPTION_STYLE_PRESETS) {
        same(captionStyleAll(tl, preset.style), applyCaptionStyle(tl, preset.style));
        expect(captionStylePresetId(preset.style)).toBe(preset.id); expect(Object.isFrozen(preset.style)).toBe(true);
    }
    expect(JSON.stringify(tl)).toBe(before);
});
test('exports subtitle files and scoped transcripts', () => {
    const tl = source();
    tl.tracks.push({ id: 'text-1', kind: 'text', name: 'Other', locked: false, muted: false, hidden: false });
    tl.text.push({ ...tl.text[0], id: 'other', trackId: 'text-1', text: 'Other', words: [] });
    expect(captionExport(emptyTimeline(), 'srt')).toBeNull();
    for (const format of ['srt', 'vtt'] as const) expect(captionExport(tl, format)?.body).toBe(exportCaptions(tl, format));
    expect(captionExport(tl, 'txt', 'text-0')?.body).toBe(transcriptText(tl, 'text-0'));
    expect(captionExport(tl, 'txt')?.body).toBe('Hello world\nOther');
});
test('bounded refusals leave input unchanged', () => {
    const tl = emptyTimeline(), before = JSON.stringify(tl);
    for (const [text, name, key] of [
        ['x'.repeat(262145), 'a.srt', 'fileTooLarge'], ['', 'a.srt', 'fileCount'],
        [Array(151).fill(srt).join('\n\n'), 'a.srt', 'fileCount'], [srt, 'a.docx', 'fileType'],
    ]) expect(importCaptionText(tl, text, name)).toEqual({ refused: { key: `editorCaptionTools.${key}` } });
    expect(JSON.stringify(tl)).toBe(before);
    tl.tracks.find(t => t.kind === 'text')!.locked = true;
    expect(importCaptionText(tl, srt, 'a.srt')).toEqual({ refused: { key: 'editorCaptionTools.locked' } });
    const timed = source(); timed.text[0] = { ...timed.text[0], len: 2, text: 'one two three', words: [] };
    expect(wordsDistribute(timed, timed.text[0].id)).toEqual({ refused: { key: 'editorCaptionTools.distributeShort' } });
    const estimated = wordsDistribute(source(), source().text[0].id);
    if ('timeline' in estimated) expect(lyricsAlign(estimated.timeline, 'Hello world', 'all')).toEqual({ refused: { key: 'editorCaptionTools.lyricsNoTiming' } });
});
test('missing lyrics return the actual bounded token without parsing English', () => {
    expect(lyricsAlign(source(), 'Hello missing world', 'all')).toEqual({ refused: { key: 'editorCaptionTools.lyricsNoMatch', params: { word: 'missing' } } });
});
test('trimmed words retain their full shared frame domain', () => {
    const tl = source(); tl.text[0] = { ...tl.text[0], text: 'Hello', len: 30, words: [{ text: 'Hello', start: -270, len: 300 }] };
    same(wordEdit(tl, tl.text[0].id, 0, 'start', -269), updateSequenceClip(tl, 'text', tl.text[0].id,
        { words: [{ text: 'Hello', start: -269, len: 300 }], wordsEstimated: true }));
});
