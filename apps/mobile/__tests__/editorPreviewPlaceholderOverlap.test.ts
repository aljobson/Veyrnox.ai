import { readFileSync } from 'fs';
import { join } from 'path';

// QA 6.2: with a bottom tool panel open the preview is a short strip, and the
// "Move the playhead onto a visual clip" placeholder was drawn under the text layer.
describe('Editor preview: placeholder vs text layer', () => {
    const source = readFileSync(join(__dirname, '../src/components/editor/EditorPlayback.tsx'), 'utf8');
    test('the placeholder is not drawn while a text layer is showing', () => {
        expect(source).toMatch(/\{!active && !caption \? <>/);
        expect(source).toMatch(/\{caption \? <Text style=\{styles\.previewCaption\}>/);
    });
});
