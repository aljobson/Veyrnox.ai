import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(__dirname, '../src/app/(app)/beats/[id].tsx'), 'utf8');

test('music editor defaults to the timeline without the engineering readout or inline instrument wall', () => {
    expect(source).not.toContain('beat-studio-readout');
    expect(source).toContain('testID="beat-editor-quick-settings"');
    expect(source).toContain("doc.view === 'pattern' ? <BeatInstrumentsSection");
    expect(source).toContain('onAdd={() => setAddTrackOpen(true)} onExport={() => setExporting(true)}');
});
