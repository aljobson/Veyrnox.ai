import type { BeatEditorLayout } from './editorLayout';
import { beatEditorLayout } from './editorLayout';

export type BeatPianoLayout = {
    mode: BeatEditorLayout;
    rollHeight: number;
    dockKeyboard: boolean;
    compactKeyboard: boolean;
};

export function beatPianoLayout(width: number, height: number, fontScale: number, appScale: number): BeatPianoLayout {
    const mode = beatEditorLayout(width, height, fontScale, appScale);
    const effectiveScale = Math.max(1, fontScale) * Math.max(1, appScale);
    if (mode === 'accessible') return { mode, rollHeight: Math.max(220, Math.min(340, height * 0.38)), dockKeyboard: false, compactKeyboard: false };
    if (mode === 'regular') return { mode, rollHeight: Math.max(264, Math.min(400, height * 0.48)), dockKeyboard: effectiveScale <= 1.15, compactKeyboard: true };
    return { mode, rollHeight: Math.max(240, Math.min(340, height * 0.42)), dockKeyboard: false, compactKeyboard: width < 430 };
}
