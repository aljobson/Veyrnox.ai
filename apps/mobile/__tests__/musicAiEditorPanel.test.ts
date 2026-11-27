import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(__dirname, '../src/components/beats/ai/BeatAiPanel.tsx'), 'utf8');

test('AI music editing is an inline composer with a compact context menu', () => {
    expect(source).toContain('testID="music-ai-editor"');
    expect(source).toContain('testID="music-ai-actions"');
    expect(source).toContain('testID="music-ai-context"');
    expect(source).toContain('accessibilityState={{ expanded: contextOpen }}');
    expect(source).toContain("icon={action.icon} iconOnly");
    expect(source).toContain('accessibilityState={{ selected: action.op === op }}');
    expect(source).toContain('embedded />');
    for (const icon of ['magicWand', 'waveform', 'crosshair', 'arrowsHorizontal', 'scissors']) {
        expect(source).toContain(`icon: '${icon}'`);
    }
    expect(source).toContain('testID={`music-ai-${action.op}`}');
    expect(source).not.toContain('<BeatModal');
});
