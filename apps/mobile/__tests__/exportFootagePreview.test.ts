import { boundedExportPreviewFrame } from '../src/components/editor/ExportFootagePreview';
import { emptyTimeline } from '../src/lib/nativeEditorModel';

test('export footage preview clamps compositor progress to a valid timeline frame', () => {
    const timeline = { ...emptyTimeline(), text: [{ id: 't', text: 'Title', start: 0, len: 90, x: .5, y: .5, size: 6 }] };
    expect(boundedExportPreviewFrame(-10, timeline)).toBe(0);
    expect(boundedExportPreviewFrame(41.6, timeline)).toBe(42);
    expect(boundedExportPreviewFrame(999, timeline)).toBe(89);
    expect(boundedExportPreviewFrame(10, emptyTimeline())).toBe(0);
});
