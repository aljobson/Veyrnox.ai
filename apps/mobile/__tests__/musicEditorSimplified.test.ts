import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(__dirname, '../src/app/(app)/beats/[id].tsx'), 'utf8');

test('music editor stays on the timeline, exposes AI editing and has no beat-maker switch', () => {
    expect(source).not.toContain('beat-studio-readout');
    expect(source).toContain('testID="beat-editor-quick-settings"');
    expect(source).not.toContain("label={t(doc.view === 'song' ? 'beat.view.pattern'");
    expect(source).toContain('aiToolsOpen ? <BeatAiPanel doc={doc} apply={apply} disabled={locked} visible');
    expect(source).toContain('showPatterns={false}');
    expect(source).toContain('showPatterns={false} showHistory={false}');
    expect(source).toContain('onAdd={toggleAddTools} onAi={toggleAiTools}');
    expect(source).toContain('subMenu={addTrackOpen');
    expect(source).toContain('headerRight: () => <HeaderAction testID="beat-editor-export"');
});
