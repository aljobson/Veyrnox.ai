import { editorPreviewPlan, LEGACY_EDITOR_PREVIEW_CAPABILITIES } from '../src/lib/editorPreviewPlan';
import { CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES } from '../src/lib/editorLocalExport';
import { emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';
import { bindStaticPreviewPlan } from '../src/lib/editorRender/plan';

function timeline(): Timeline {
    const base = emptyTimeline();
    return {
        ...base,
        media: {
            subject: { id: 'subject', name: 'Subject', kind: 'image', frames: 90, width: 1080, height: 1920, hasAudio: false },
            mask: { id: 'mask', name: 'Person mask', kind: 'image', frames: 1, width: 384, height: 384, hasAudio: false },
            overlay: { id: 'overlay', name: 'Overlay', kind: 'image', frames: 90, width: 400, height: 400, hasAudio: false },
        },
        tracks: [...base.tracks, { id: 'video-1', kind: 'video', name: 'Video 2', locked: false, muted: false, hidden: false }],
        video: [
            { id: 'v1', mediaId: 'subject', start: 0, in: 0, len: 90, trackId: 'video-0', volume: 1, transition: 0,
                semanticMask: { version: 1, mediaId: 'mask', category: 'person', sourceFrame: 0 } },
            { id: 'v2', mediaId: 'overlay', start: 0, in: 0, len: 90, trackId: 'video-1', volume: 1, transition: 0, behindSubject: 'v1' },
        ],
        text: [{ id: 't3', text: 'Behind', start: 0, len: 90, trackId: 'text-0', x: .5, y: .5, size: 8, behindSubject: 'v1' }],
        seq: 3,
    };
}

test('mobile preview explicitly reports behind-subject as approximate', () => {
    const plan = editorPreviewPlan(timeline(), 0, LEGACY_EDITOR_PREVIEW_CAPABILITIES);
    const uses = plan.capabilities.requirements.filter(use => use.capability === 'behind-subject');
    expect(uses.map(use => use.itemId)).toEqual(['v2', 't3']);
    expect(uses.every(use => !use.supported)).toBe(true);
    expect(plan.capabilities.exact).toBe(false);
    const bound = bindStaticPreviewPlan(plan, 1080, 1920, {});
    expect(bound.layers.flatMap(layer => layer.unsupported ?? [])).toContain('behind-subject');
});

test('local export advertises exact behind-subject ordering', () => {
    expect(CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES).toContain('behind-subject');
    const plan = editorPreviewPlan(timeline(), 0, CANONICAL_EDITOR_COMPOSITOR_CAPABILITIES);
    expect(plan.capabilities.unsupported.map(use => use.capability)).not.toContain('behind-subject');
    expect(plan.capabilities.exact).toBe(true);
});
