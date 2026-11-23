import { readFileSync } from 'node:fs';
import { join } from 'node:path';

declare const __dirname: string;
const source = (path: string) => readFileSync(join(__dirname, '../src/app', path), 'utf8');

describe('landscape contracts for Film and public utility routes', () => {
    test.each(['(app)/film/workspace.tsx', '(app)/report.tsx'])('%s reveals focused fields above the keyboard', path => {
        const text = source(path);
        expect(text).toContain('<KeyboardScreen');
        expect(text).toContain('<KeyboardFormScrollView');
    });

    test('the public review form protects every physical edge and reveals its comment field', () => {
        const text = source('review.tsx');
        expect(text).toContain('screenSafePadding(insets, 16, true)');
        expect(text).toContain('<KeyboardFormScrollView');
        expect(text).toContain('LIST_END_PADDING + insets.bottom');
    });

    test('public browse and editorial chrome protect landscape sides without shrinking video', () => {
        const preview = source('preview.tsx');
        expect(preview).toContain('paddingLeft: insets.left');
        expect(preview).toContain('paddingRight: insets.right');
        const editorial = source('editorial/[id].tsx');
        expect(editorial).toContain('paddingLeft: insets.left + 16');
        expect(editorial).toContain('paddingRight: insets.right + 16');
        expect(editorial).toMatch(/<YouTubeEmbed key=\{attempt\}/);
    });
});
