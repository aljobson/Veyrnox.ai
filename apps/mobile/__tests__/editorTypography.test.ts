import { EDITOR_DECORATIVE_RULER_FONT_SIZE, EDITOR_MEANINGFUL_LABEL_MIN_SIZE } from '../src/components/editor/fullEditorStyles';

declare const require: (id: string) => any;
declare const __dirname: string;

const fs = require('fs');
const path = require('path');
const editorRoot = path.join(__dirname, '../src/components/editor');
const DECORATIVE_SMALL_TEXT_ALLOWLIST = {
    'fullEditorStyles.ts:rulerText': { accessibleEquivalentTestId: 'timeline-ruler', role: 'adjustable' },
} as const;

function componentFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry: { isDirectory(): boolean; name: string }) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return componentFiles(fullPath);
        return /\.tsx?$/.test(entry.name) ? [fullPath] : [];
    });
}

test('all editor component font sizes keep the meaningful-label floor with one decorative ruler exception', () => {
    const literalViolations: string[] = [];
    const unsupportedFontSizes: string[] = [];
    const decorativeUsages: string[] = [];

    for (const file of componentFiles(editorRoot)) {
        const source = fs.readFileSync(file, 'utf8');
        const relative = path.relative(editorRoot, file);
        for (const match of source.matchAll(/fontSize:\s*([^,}\n]+)/g)) {
            const value = match[1].trim();
            if (value === 'EDITOR_DECORATIVE_RULER_FONT_SIZE') continue;
            if (value === 'undefined') continue; // Explicitly removes an inherited font size before a computed accessible size is applied.
            if (!/^\d+(?:\.\d+)?$/.test(value)) {
                unsupportedFontSizes.push(`${relative}:${value}`);
                continue;
            }
            const size = Number(value);
            if (size < EDITOR_MEANINGFUL_LABEL_MIN_SIZE) literalViolations.push(`${relative}:${size}`);
        }
        for (const match of source.matchAll(/([A-Za-z0-9_]+)\s*:\s*\{[^}\n]*fontSize:\s*EDITOR_DECORATIVE_RULER_FONT_SIZE/g)) {
            decorativeUsages.push(`${relative}:${match[1]}`);
        }
    }

    expect(literalViolations).toEqual([]);
    expect(unsupportedFontSizes).toEqual([]);
    expect(EDITOR_DECORATIVE_RULER_FONT_SIZE).toBeLessThan(EDITOR_MEANINGFUL_LABEL_MIN_SIZE);
    expect(decorativeUsages).toEqual(Object.keys(DECORATIVE_SMALL_TEXT_ALLOWLIST));

    const timelineSource = fs.readFileSync(path.join(editorRoot, 'EditorTimeline.tsx'), 'utf8');
    const equivalent = DECORATIVE_SMALL_TEXT_ALLOWLIST['fullEditorStyles.ts:rulerText'];
    expect(timelineSource).toContain(`testID="${equivalent.accessibleEquivalentTestId}"`);
    expect(timelineSource).toContain(`accessibilityRole="${equivalent.role}"`);
});
