export type BeatEditorLayout = 'compact' | 'accessible' | 'regular';

// Editor chrome has to respond to both the system text size and Veyrnox's in-app text size.
// Large text deliberately wins over available width so an iPad never keeps a cramped two-column editor.
export function beatEditorLayout(width: number, fontScale: number, appScale = 1): BeatEditorLayout {
    const effectiveTextScale = Math.max(1, fontScale) * Math.max(1, appScale);
    if (effectiveTextScale > 1.35) return 'accessible';
    if (width >= 720) return 'regular';
    if (width >= 360) return 'compact';
    return 'accessible';
}
