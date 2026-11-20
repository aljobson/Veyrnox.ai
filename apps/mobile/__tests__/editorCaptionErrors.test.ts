import { readFileSync } from 'fs';
import { resolve } from 'path';
import { captionRefusal } from '../src/lib/editorCaptionErrors';
import { helperEnglish } from '../../../lib/helperMessages.mjs';
import messages from '../src/lib/i18n/messages/en/editorCaptionTools';
test.each(['editorCaptions', 'editorWords', 'editorTranscript', 'editorLyrics'])('%s error literals are all mapped', name => {
    const source = readFileSync(resolve(__dirname, '../../../app/veyrnox/_lib', `${name}.mjs`), 'utf8');
    const errors = [...source.matchAll(/error:\s*(['"`])([\s\S]*?)\1/g)].map(match => match[2].replace(/\$\{[^}]*\}/g, 'missing'));
    expect(errors.length).toBeGreaterThan(0);
    for (const error of errors) expect({ error, key: captionRefusal(error).key }).not.toEqual({ error, key: 'editorEditGate.invalid' });
});
test('sequence locks, shared word diagnostics and unknowns are mapped', () => {
    for (const error of ['Unlock this track to edit it.', 'Unlock the destination track first.', 'Add an unlocked text track first.'])
        expect(captionRefusal(error).key).toBe('editorCaptionTools.locked');
    for (const code of ['invalid_word_timing_source', 'invalid_word_highlight_style', 'word_text_or_timing_does_not_match_this'])
        expect(captionRefusal(helperEnglish(code)).key).toBe('editorCaptionTools.wordMismatch');
    expect(captionRefusal(helperEnglish('this_project_is_too_large_to_save_use')).key).toBe('editorEditGate.tooLarge');
    for (const error of ['Select a clip first.', 'unknown', 'toString', 3, null]) expect(captionRefusal(error)).toEqual({ key: 'editorEditGate.invalid' });
    for (const value of Object.values(messages)) expect(value).not.toMatch(/_|veyrnox\.ai|http|Whisper|automatic captions/);
});
