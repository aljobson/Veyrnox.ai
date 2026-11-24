import { activeEditorMedia, editorSourceTimeSeconds } from './editorPreview';
import { timelineOf } from './nativeEditorModel';

// Which creation stands for a saved editor project in a list: the first picture or clip on its
// timeline, then any other media. Returns a job id, or null for an empty project.
const MEDIA_ID = /^j-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:--[a-z]+)?$/;
const ORDER = ['video', 'image', 'overlay', 'audio'];
const MAX_NODES = 2000;

function firstMediaId(node: unknown, budget: { left: number }): string | null {
    const stack: unknown[] = [node];
    while (stack.length && budget.left-- > 0) {
        const value = stack.shift();
        if (Array.isArray(value)) { stack.unshift(...value); continue; }
        if (!value || typeof value !== 'object') continue;
        const record = value as Record<string, unknown>;
        if (typeof record.mediaId === 'string') {
            const match = MEDIA_ID.exec(record.mediaId);
            if (match) return match[1];
        }
        stack.unshift(...Object.values(record));
    }
    return null;
}

export function coverJobId(document: unknown): string | null {
    const timeline = document && typeof document === 'object' ? (document as { timeline?: unknown }).timeline : null;
    if (!timeline || typeof timeline !== 'object') return null;
    const groups = timeline as Record<string, unknown>;
    const budget = { left: MAX_NODES };
    const keys = [...ORDER.filter(key => key in groups), ...Object.keys(groups).filter(key => !ORDER.includes(key))];
    for (const key of keys) {
        const found = firstMediaId(groups[key], budget);
        if (found) return found;
    }
    return null;
}

export interface ProjectCover {
    readonly jobId: string | null;
    readonly posterTimeSeconds?: number;
    readonly text: string;
    readonly textColor: string;
    readonly background: string;
}

// Resolve the frame the editor saved, not merely the first clip in the project. The list thumbnail
// intentionally stays lightweight: it uses the uppermost visual at that frame plus the dedicated
// cover title, while the editor remains the source of truth for the full composition.
export function projectCover(document: unknown): ProjectCover | null {
    if (!document || typeof document !== 'object') return null;
    const value = document as { timeline?: unknown; cover?: unknown };
    const fallbackJobId = coverJobId(document);
    const rawCover = value.cover;
    if (!rawCover || typeof rawCover !== 'object') {
        return fallbackJobId ? { jobId: fallbackJobId, text: '', textColor: '#FFFFFF', background: '#000000' } : null;
    }
    const saved = rawCover as { frame?: unknown; text?: unknown; text_color?: unknown };
    if (!Number.isSafeInteger(saved.frame) || Number(saved.frame) < 0) {
        return fallbackJobId ? { jobId: fallbackJobId, text: '', textColor: '#FFFFFF', background: '#000000' } : null;
    }
    const timeline = timelineOf(value.timeline);
    const frame = Number(saved.frame);
    const active = activeEditorMedia(timeline, frame);
    const activeJob = active ? MEDIA_ID.exec(active.media.id)?.[1] ?? null : null;
    return {
        jobId: activeJob ?? fallbackJobId,
        ...(activeJob && active ? { posterTimeSeconds: editorSourceTimeSeconds(active.clip, frame, timeline.fps) } : {}),
        text: typeof saved.text === 'string' ? saved.text.trim() : '',
        textColor: typeof saved.text_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(saved.text_color) ? saved.text_color : '#FFFFFF',
        background: /^#[0-9a-fA-F]{6}$/.test(timeline.background) ? timeline.background : '#000000',
    };
}
