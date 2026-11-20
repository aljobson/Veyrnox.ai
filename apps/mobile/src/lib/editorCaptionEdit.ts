import { parseCaptions, insertCaptions, exportCaptions, applyCaptionStyle } from '../../../../app/veyrnox/_lib/editorCaptions.mjs';
import { WORD_STYLE, distributeWords } from '../../../../app/veyrnox/_lib/editorWords.mjs';
import { updateSequenceClip } from '../../../../app/veyrnox/_lib/editorSequence.mjs';
import { cutTranscriptRange, correctTranscriptWord, transcriptText } from '../../../../app/veyrnox/_lib/editorTranscript.mjs';
import { alignLyricCaptions } from '../../../../app/veyrnox/_lib/editorLyrics.mjs';
import { TEXT_DEFAULTS } from '../../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { captionRefusal, type CaptionRefusal } from './editorCaptionErrors';
import type { Timeline, TextClip } from './nativeEditorModel';
export type CaptionResult = { timeline: Timeline; count?: number } | { refused: CaptionRefusal };
export type TranscriptSelection = { first: string; last: string } | null;
export type CaptionFile = { name: 'captions.srt' | 'captions.vtt' | 'transcript.txt'; mimeType: string; uti: string; body: string };
type WebResult = Timeline | { error: string };
const result = (next: WebResult): CaptionResult => 'error' in next ? { refused: captionRefusal(next.error) } : { timeline: next };
function run(edit: () => WebResult): CaptionResult {
    try { return result(edit()); } catch { return { refused: { key: 'editorEditGate.invalid' } }; }
}
export function importCaptionText(tl: Timeline, text: string, fileName: string): CaptionResult {
    const ext = fileName.includes('.') ? fileName.split('.').at(-1)!.toLowerCase() : '';
    if (!['srt', 'vtt', 'ass', 'lrc', 'json'].includes(ext)) return { refused: { key: 'editorCaptionTools.fileType' } };
    const parsed = parseCaptions(text, ext);
    if ('error' in parsed) return { refused: captionRefusal(parsed.error) };
    const next = run(() => insertCaptions(tl, parsed.cues) as WebResult);
    return 'timeline' in next ? { ...next, count: parsed.cues.length } : next;
}
export function captionExport(tl: Timeline, format: 'srt' | 'vtt' | 'txt', trackId = 'all'): CaptionFile | null {
    if (!tl.text.some(c => c.caption && (format !== 'txt' || trackId === 'all' || c.trackId === trackId))) return null;
    return { name: format === 'txt' ? 'transcript.txt' : format === 'srt' ? 'captions.srt' : 'captions.vtt',
        mimeType: format === 'txt' ? 'text/plain' : format === 'srt' ? 'application/x-subrip' : 'text/vtt', uti: 'public.plain-text',
        body: format === 'txt' ? transcriptText(tl, trackId) : exportCaptions(tl, format) };
}
const patch = (tl: Timeline, id: string, change: Partial<TextClip>) => run(() => updateSequenceClip(tl, 'text', id, change) as WebResult);
export const captionTextEdit = (tl: Timeline, id: string, text: string) => patch(tl, id, { text });
export function wordEdit(tl: Timeline, id: string, index: number, key: 'start' | 'len', frames: number): CaptionResult {
    const cue = tl.text.find(c => c.id === id);
    if (!cue?.words?.[index]) return { refused: { key: 'editorCaptionTools.wordMismatch' } };
    return patch(tl, id, { words: cue.words.map((word, i) => i === index ? { ...word, [key]: frames } : word), wordsEstimated: true });
}
export function wordStyleEdit(tl: Timeline, id: string, change: Partial<NonNullable<TextClip['wordStyle']>>): CaptionResult {
    return patch(tl, id, { wordStyle: { ...WORD_STYLE, ...tl.text.find(c => c.id === id)?.wordStyle, ...change } as TextClip['wordStyle'] });
}
export function wordsDistribute(tl: Timeline, id: string): CaptionResult {
    const cue = tl.text.find(c => c.id === id);
    if (!cue) return { refused: { key: 'editorEditGate.invalid' } };
    const words = distributeWords(cue);
    return 'error' in words ? { refused: captionRefusal(words.error) } : patch(tl, id, words);
}
export const wordsClear = (tl: Timeline, id: string) => patch(tl, id, { words: [], wordsEstimated: true });
export const transcriptCut = (tl: Timeline, selection: TranscriptSelection, trackId = 'all') =>
    run(() => cutTranscriptRange(tl, selection, trackId) as WebResult);
export const transcriptCorrect = (tl: Timeline, key: string, text: string) => run(() => correctTranscriptWord(tl, key, text) as WebResult);
export function lyricsAlign(tl: Timeline, lyrics: string, sourceId = 'all'): CaptionResult {
    const next = run(() => alignLyricCaptions(tl, lyrics, sourceId) as WebResult);
    if (!('refused' in next) || next.refused.key !== 'editorCaptionTools.lyricsNoMatch') return next;
    // Probe whole lyric prefixes through the shared matcher. Its first failing prefix identifies the actual token.
    const tokens = [...lyrics.matchAll(/\S+/g)];
    let low = 1, high = tokens.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        const probe = alignLyricCaptions(tl, lyrics.slice(0, tokens[mid - 1].index! + tokens[mid - 1][0].length), sourceId) as WebResult;
        if ('error' in probe && captionRefusal(probe.error).key === 'editorCaptionTools.lyricsNoMatch') high = mid;
        else low = mid + 1;
    }
    return { refused: { key: 'editorCaptionTools.lyricsNoMatch', params: { word: tokens[low - 1][0].slice(0, 80) } } };
}
export const captionStyleAll = (tl: Timeline, style: TextClip['style'] | 'web') => run(() => applyCaptionStyle(tl,
    { ...TEXT_DEFAULTS, ...(style === 'web' ? { color: '#ffe66d', backgroundOpacity: .7 } : style) }) as WebResult);
