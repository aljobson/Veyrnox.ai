import { runCommand, validateAgentTimeline, type Command } from './editorAgentOperations';
import { bestCutCaptions } from './bestCutCaptions';
import { validateBestCutPlan, type BestCutPlan, type BestCutInput } from './bestCutPlan';
import { emptyTimeline, type Timeline, type Media } from './nativeEditorModel';
export function bestCutBefore(media: Media[], fps = 30): Timeline {
    const base = { ...emptyTimeline(), fps }; let start = 0;
    for (const item of media) {
        base.media[item.id] = item;
        const len = item.frames || 0;
        base.video.push({ id: `v${++base.seq}`, mediaId: item.id, start, len, in: 0, trackId: 'video-0', volume: 1, rate: 1, transition: 0 }); start += len;
    }
    return base;
}
/** Closed, validated editor commands compile to one value. Caller records exactly one history entry. */
export function applyBestCut(before: Timeline, plan: BestCutPlan, inputs: BestCutInput[], captions = true): { timeline: Timeline; operations: Command[]; captionsOmitted: boolean } | null {
    if (before.fps !== plan.fps || !validateBestCutPlan(plan, inputs) || validateAgentTimeline(before)) return null;
    let timeline = before; const operations: Command[] = [];
    function apply(command: Command): boolean {
        const result = runCommand(timeline, command); if ('error' in result) return false;
        timeline = result; operations.push(command); return true;
    }
    for (const kind of ['video', 'audio', 'text'] as const) for (const item of before[kind]) if (!apply({ op: 'remove', kind, id: item.id })) return null;
    for (const range of plan.ranges) {
        if (!apply({ op: 'insertMedia', mediaId: range.mediaId, start: range.start })) return null;
        const id = `v${timeline.seq}`, clip = timeline.video.find(c => c.id === id); if (!clip) return null;
        if (!apply({ op: 'trim', kind: 'video', id, edge: 'out', frames: range.to - clip.len })) return null;
        if (range.from && !apply({ op: 'trim', kind: 'video', id, edge: 'in', frames: range.from })) return null;
        if (!apply({ op: 'move', kind: 'video', id, start: range.start })) return null;
    }
    let captionsOmitted = false;
    if (captions) {
        const lane = timeline.tracks.find(t => t.kind === 'text' && !t.locked); if (!lane) return null;
        const generated = bestCutCaptions(plan, inputs, lane.id, timeline.seq);
        captionsOmitted = generated.omitted;
        for (const item of generated.items) if (!apply({ op: 'addText', text: item.text, start: item.start, len: item.len })) return null;
    }
    return validateAgentTimeline(timeline) ? null : { timeline, operations, captionsOmitted };
}
