import type { Canvas, Clip, EditorTrack, Media, Selection, TextClip, Timeline, TrackKind } from '../../../lib/nativeEditorModel';
import type { ProjectDocument } from '../../../lib/editorBridge';
import type { SlotKind } from '../../../lib/sources';
import type { Kind } from '../../../lib/media';

export type ToolPanelProps = {
    timeline: Timeline; selection: Selection | null; selected: Clip | TextClip | undefined;
    selections: Selection[]; selectedMedia: Media | undefined; selectedTrack: EditorTrack | undefined;
    patchSelected(patch: Partial<Clip & TextClip>): void; applyTimeline(timeline: Timeline): boolean;
    availableMedia: Media[]; addMediaToTimeline(media: Media): unknown;
    libraryPending: boolean; replacing: boolean; setLibraryKind(kind: SlotKind): void;
    choosePhotos(): Promise<void>; chooseFiles(): Promise<void>;
    selectClip(selection: Selection): void; openVoiceover(): void; openGenerate(kind: Kind): void;
    addTimelineTrack(kind: TrackKind): unknown; addText(): void; addCaption(): void; updateSelectedText(text: string): void;
    setFrame(frame: number): void; setPlaying(playing: boolean): void; addTimelineMarker(): unknown;
    currentDocument(): ProjectDocument | null; document: ProjectDocument;
    markDocument(doc: ProjectDocument): boolean; canvas: Canvas; updateCanvas(patch: Partial<Canvas>): void;
    updateTrack(track: EditorTrack, patch: Partial<EditorTrack>): unknown;
    canMove(direction: -1 | 1): boolean; moveSelection(direction: -1 | 1): void; removeSelection(): void;
    adjustStart(delta: number): void; adjustLength(delta: number): void; changeSpeed(rate: number): void; toggleReverse(): void;
};
