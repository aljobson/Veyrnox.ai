import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(__dirname, '../src/components/beats/ai/BeatAiPanel.tsx'), 'utf8');

test('AI music editing is a compact icon toolbar, not a wall of action buttons', () => {
    expect(source).toContain('testID="music-ai-editor"');
    expect(source).toContain('testID="music-ai-actions"');
    expect(source).toContain('iconOnly');
    for (const icon of ['magicWand', 'waveform', 'crosshair', 'arrowsHorizontal', 'scissors']) {
        expect(source).toContain(`icon: '${icon}'`);
    }
});
