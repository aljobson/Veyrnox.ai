export type BeatEditorLayout = 'compact' | 'accessible' | 'regular';

// Editor chrome has to respond to both the system text size and Veyrnox's in-app text size.
// Large text deliberately wins over available width so an iPad never keeps a cramped two-column editor.
export function beatEditorLayout(width: number, height: number, fontScale: number, appScale: number): BeatEditorLayout;
/** @deprecated Pass width, height, system font scale, and app text scale. */
export function beatEditorLayout(width: number, fontScale: number, appScale?: number): BeatEditorLayout;
export function beatEditorLayout(width: number, heightOrFontScale: number, fontScaleOrAppScale = 1, appScale?: number): BeatEditorLayout {
    // Keep old callers safe while the main editor route is migrated by its owner. New callers always pass four values.
    const legacy = appScale === undefined;
    const height = legacy ? Number.POSITIVE_INFINITY : heightOrFontScale;
    const fontScale = legacy ? heightOrFontScale : fontScaleOrAppScale;
    const resolvedAppScale = legacy ? fontScaleOrAppScale : appScale;
    const effectiveTextScale = Math.max(1, fontScale) * Math.max(1, resolvedAppScale);
    if (effectiveTextScale > 1.35) return 'accessible';
    if (width >= 720 && height >= 600) return 'regular';
    if (width >= 360) return 'compact';
    return 'accessible';
}
