declare const require: (id: string) => { readFileSync(path: string, utf8: string): string };
declare const __dirname: string;
const read = (rel: string) => require('fs').readFileSync(`${__dirname}/../src/${rel}`, 'utf8');

describe('editor tool panels sit in a bottom sheet', () => {
    const screen = read('components/editor/FullEditorScreen.tsx');
    it('renders the inspector inside EditorToolSheet, not as an inline flex sibling', () => {
        expect(screen).toMatch(/<EditorToolSheet[\s\S]*styles\.inspector[\s\S]*<\/EditorToolSheet>/);
    });
    it('does not draw the Add / AI Edit / More bar over an open panel (QA 8.7: the bar floated mid-panel)', () => {
        expect(screen).toMatch(/\{advanced \|\| panelOpen \? null : <SimpleEditorBar/);
        expect(screen).not.toMatch(/\{advanced \? null : <SimpleEditorBar/);
    });
    it('keeps the sheet clear of the home indicator and above the keyboard', () => {
        const sheet = read('components/editor/EditorToolSheet.tsx');
        expect(sheet).toContain('SafeAreaInsetsContext');
        expect(sheet).toMatch(/keyboard(Will|Did)Show/);
        expect(sheet).toMatch(/bottom: keyboard/);
    });
    it('keeps the sheet inside the visible area at the smallest iPhone height', () => {
        const { toolSheetHeight } = (require('../src/components/editor/EditorToolSheet') as unknown) as { toolSheetHeight(h: number): number };
        expect(toolSheetHeight(568)).toBeGreaterThanOrEqual(250);
        expect(toolSheetHeight(568)).toBeLessThanOrEqual(568 * 0.5);
        expect(toolSheetHeight(932)).toBeLessThanOrEqual(420);
    });
});

describe('stems result footer', () => {
    const job = read('app/(app)/job/[id].tsx');
    it('renders the expiry footer inside the stems scroll content, after the player', () => {
        const stems = job.slice(job.indexOf('<StemList'), job.indexOf(') : asset ? ('));
        expect(stems).toContain('{retentionFooter}');
        expect(job).toMatch(/stems\.length > 0 && asset \? null : retentionFooter/);
    });
});
