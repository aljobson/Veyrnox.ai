import type { Clip, TextClip, Timeline, TrackKind } from '../../../apps/mobile/src/lib/nativeEditorModel';

export function behindSubjectCandidates(timeline: Timeline, overlay: Clip | TextClip | undefined): Clip[];
export function setBehindSubject(timeline: Timeline, kind: TrackKind, id: string, subjectId: string | null | undefined): Timeline | { error: string };
