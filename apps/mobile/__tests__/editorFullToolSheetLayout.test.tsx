import { act } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createRoot } from 'test-renderer';
import { EditorToolSheet } from '../src/components/editor/EditorToolSheet';

declare const require: (id: string) => { readFileSync(path: string, utf8: string): string };
declare const __dirname: string;
const screen = require('fs').readFileSync(`${__dirname}/../src/components/editor/FullEditorScreen.tsx`, 'utf8');
void [Text, View];
jest.setTimeout(30000);

const styleOf = async (inline: boolean, wide = false) => {
    const root = createRoot();
    await act(async () => { root.render(<EditorToolSheet inline={inline} wide={wide}><Text>panel</Text></EditorToolSheet>); });
    const node = root.container.queryAll(n => n.props.testID === 'editor-tool-sheet')[0];
    return StyleSheet.flatten(node?.props.style) as Record<string, unknown>;
};

describe('full editor keeps the timeline visible above the tool panel', () => {
    it('an inline sheet takes the space left under the timeline instead of covering it', async () => {
        const style = await styleOf(true);
        expect(style.position).not.toBe('absolute');
        expect(style.flex).toBe(1);
        expect(style.minHeight).toBeGreaterThan(0);
    });
    it('the overlay sheet (simple editor) is unchanged', async () => {
        const style = await styleOf(false);
        expect(style.position).toBe('absolute');
    });
    it('the full editor mounts the sheet inline, after the timeline section', () => {
        expect(screen).toMatch(/<EditorToolSheet inline=\{advanced\}/);
        expect(screen.indexOf('styles.timelineSection')).toBeLessThan(screen.indexOf('<EditorToolSheet'));
    });
    it('phone landscape turns the inspector into a bounded third pane', async () => {
        const style = await styleOf(true, true);
        expect(style.minHeight).toBe(0);
        expect(style.minWidth).toBe(220);
        expect(style.maxWidth).toBe('42%');
        expect(screen).toContain('styles.editorWorkspaceWide');
        expect(screen).toContain('wide={advanced && budget.wideShort}');
    });
    it('the inline inspector participates in keyboard avoidance for text and caption fields', async () => {
        const root = createRoot();
        await act(async () => { root.render(<EditorToolSheet inline wide><Text>panel</Text></EditorToolSheet>); });
        const node = root.container.queryAll(n => n.props.testID === 'editor-tool-sheet')[0];
        expect(node.props.keyboardVerticalOffset).toBeGreaterThan(0);
        expect(node.props.behavior).toBeTruthy();
    });
    it('the inline sheet honours a minimum panel height and the timeline is a bounded scroll region', async () => {
        const root = createRoot();
        await act(async () => { root.render(<EditorToolSheet inline minHeight={300}><Text>panel</Text></EditorToolSheet>); });
        const node = root.container.queryAll(n => n.props.testID === 'editor-tool-sheet')[0];
        expect((StyleSheet.flatten(node?.props.style) as Record<string, unknown>).minHeight).toBe(300);
        expect(screen).toMatch(/testID="editor-timeline-scroll"/);
        expect(screen).toMatch(/editorLayoutBudget\(/);
    });
});
