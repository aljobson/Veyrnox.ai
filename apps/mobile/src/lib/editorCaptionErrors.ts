import { helperDiagnostic, helperEnglish } from '../../../../lib/helperMessages.mjs';
import type messages from './i18n/messages/en/editorCaptionTools';
export type CaptionRefusal = { key: keyof typeof messages | 'editorEditGate.invalid' | 'editorEditGate.tooLarge'; params?: { word: string } };
// Compatibility boundary for the four web libraries' literal error contracts. Never display these strings.
const errors: Record<string, CaptionRefusal['key']> = {
    'Choose a subtitle file under 256 KiB.': 'editorCaptionTools.fileTooLarge',
    'A subtitle timing line is invalid.': 'editorCaptionTools.fileTiming',
    'ASS needs an Events Format with Start, End and Text last.': 'editorCaptionTools.fileTiming',
    'Choose SRT, VTT, ASS or LRC.': 'editorCaptionTools.fileType',
    'Choose a file with 1 to 150 subtitle lines.': 'editorCaptionTools.fileCount',
    'Subtitle text or timing is outside the 10-minute project.': 'editorCaptionTools.fileTiming',
    'Choose a timed caption range.': 'editorCaptionTools.transcriptChoose',
    'Unlock the affected tracks before cutting this range.': 'editorCaptionTools.locked',
    'Give each word at least one frame; use a longer caption or fewer words.': 'editorCaptionTools.distributeShort',
    'Word timing JSON is invalid.': 'editorCaptionTools.wordFile',
    'Word timing JSON needs 1–3000 word/start/end entries.': 'editorCaptionTools.wordFile',
    'A word text or timing is invalid.': 'editorCaptionTools.wordFile',
    'Word timings must be ordered, non-overlapping and at least one frame long.': 'editorCaptionTools.wordFile',
    'This file needs more than 150 caption cues; split it into shorter parts.': 'editorCaptionTools.fileCount',
    'Select a current transcript word or caption range.': 'editorCaptionTools.transcriptChoose',
    'Choose words on one caption track; overlapping transcripts cannot define one cut.': 'editorCaptionTools.transcriptOneTrack',
    'Use complete source word timestamps for word cuts. Estimated or trimmed word timing needs correction first.': 'editorCaptionTools.transcriptEstimated',
    'These transcript intervals overlap. Choose one caption track or correct its timings first.': 'editorCaptionTools.transcriptOneTrack',
    'Choose one timed word to correct.': 'editorCaptionTools.correctChoose',
    'Correct one word at a time, up to 100 characters without spaces.': 'editorCaptionTools.correctOneWord',
    'Use lyrics under 16 KiB without control characters.': 'editorCaptionTools.lyricsSize',
    'Use 1–150 lyric lines, with up to 100 words and 1000 characters per line.': 'editorCaptionTools.lyricsLines',
    'Use up to 1000 lyric words; attach punctuation to its word.': 'editorCaptionTools.lyricsWords',
    'Import word timestamps or create local automatic captions first. Evenly distributed timings cannot align lyrics.': 'editorCaptionTools.lyricsNoTiming',
    'Choose one timed caption or keep the timed source on one text track.': 'editorCaptionTools.lyricsOneTrack',
    'Unlock the source caption track before aligning lyrics.': 'editorCaptionTools.locked',
    'The source needs one complete timestamp per word. Adjust trimmed words or import word timing JSON.': 'editorCaptionTools.lyricsSourceWords',
    'Source word timestamps overlap. Choose one timed caption or correct its timings.': 'editorCaptionTools.lyricsSourceOverlap',
    'Repeated words have more than one possible alignment. Choose one timed caption or include more surrounding lyrics.': 'editorCaptionTools.lyricsAmbiguous',
    'Unlock this track to edit it.': 'editorCaptionTools.locked',
    'Unlock the destination track first.': 'editorCaptionTools.locked',
    'Add an unlocked text track first.': 'editorCaptionTools.locked',
};
export function captionRefusal(error: unknown): CaptionRefusal {
    if (helperDiagnostic(error)?.code === 'this_project_is_too_large_to_save_use') return { key: 'editorEditGate.tooLarge' };
    if (typeof error !== 'string') return { key: 'editorEditGate.invalid' };
    if (['invalid_word_timing_source', 'invalid_word_highlight_style', 'word_text_or_timing_does_not_match_this']
        .some(code => error === helperEnglish(code))) return { key: 'editorCaptionTools.wordMismatch' };
    // Identify the template only. The wrapper obtains the token by rerunning the pure matcher, never by extracting English.
    if (error.startsWith('No ordered word timestamp matches “') && error.endsWith('”. Correct the source transcript or lyrics first.'))
        return { key: 'editorCaptionTools.lyricsNoMatch' };
    return { key: Object.hasOwn(errors, error) ? errors[error] : 'editorEditGate.invalid' };
}
