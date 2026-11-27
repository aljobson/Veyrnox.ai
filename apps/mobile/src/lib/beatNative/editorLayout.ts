export type BeatEditorLayout = 'compact' | 'accessible' | 'regular';

export const MUSIC_EDITOR_MIN_ARRANGEMENT_HEIGHT = 48 + 44 + 64;
export const MUSIC_EDITOR_COMPACT_TIMELINE_HEIGHT = 44 + 56;
export const MUSIC_EDITOR_EDITING_TIMELINE_HEIGHT = 44;
export const MUSIC_EDITOR_COMPACT_DOCK_HEIGHT = 44;
export const MUSIC_EDITOR_TRANSPORT_DIVIDER_HEIGHT = 1;
export const MUSIC_EDITOR_SHORT_LANDSCAPE_BOTTOM_INSET_BUDGET = 21;
const MUSIC_TRAY_MIN_HEIGHT = 44;
const MUSIC_EDITOR_DOCK_CONTROL_HEIGHT = 52;
const MUSIC_EDITOR_DOCK_PADDING = 24;
const MUSIC_EDITOR_DOCK_SHORT_PADDING = 8;
export const MUSIC_EDITOR_SUBMENU_HEADING_HEIGHT = 24;
const MUSIC_EDITOR_CONSTRAINED_VIEWPORT = 220;

export type MusicTransportLayout = { trayMaxHeight: number; compactViewport: boolean };

export const musicEditorCompactsTimeline = (width: number, height: number, toolOpen: boolean) => toolOpen && width > height && height < 500;

export function musicTransportLayout(width: number, height: number, keyboardInset = 0, headingHeight = MUSIC_EDITOR_SUBMENU_HEADING_HEIGHT, editing = false, bottomInset = 0, compactTimeline = false): MusicTransportLayout {
    const shortLandscape = width > height && height < 500;
    const rawUsableHeight = Math.max(0, height - Math.max(0, keyboardInset));
    if (shortLandscape && rawUsableHeight < MUSIC_EDITOR_CONSTRAINED_VIEWPORT) {
        return {
            trayMaxHeight: Math.max(MUSIC_TRAY_MIN_HEIGHT,
                rawUsableHeight - MUSIC_EDITOR_COMPACT_DOCK_HEIGHT - MUSIC_EDITOR_TRANSPORT_DIVIDER_HEIGHT
                    - (editing ? MUSIC_EDITOR_EDITING_TIMELINE_HEIGHT : MUSIC_EDITOR_COMPACT_TIMELINE_HEIGHT)),
            compactViewport: true,
        };
    }
    const usableHeight = Math.max(0, rawUsableHeight - Math.max(0, bottomInset));
    const dockChrome = MUSIC_EDITOR_DOCK_CONTROL_HEIGHT + (shortLandscape ? MUSIC_EDITOR_DOCK_SHORT_PADDING : MUSIC_EDITOR_DOCK_PADDING)
        + headingHeight + MUSIC_EDITOR_TRANSPORT_DIVIDER_HEIGHT;
    const available = Math.max(MUSIC_TRAY_MIN_HEIGHT, usableHeight - dockChrome);
    const preferred = Math.round(available * (shortLandscape ? 0.42 : 0.38));
    const timelineReserve = editing ? MUSIC_EDITOR_EDITING_TIMELINE_HEIGHT
        : shortLandscape && compactTimeline ? MUSIC_EDITOR_COMPACT_TIMELINE_HEIGHT : MUSIC_EDITOR_MIN_ARRANGEMENT_HEIGHT;
    const timelineSafeMaximum = Math.max(MUSIC_TRAY_MIN_HEIGHT, available - timelineReserve);
    const trayMinimum = shortLandscape && compactTimeline ? 120 : MUSIC_TRAY_MIN_HEIGHT;
    return {
        trayMaxHeight: Math.max(MUSIC_TRAY_MIN_HEIGHT,
            Math.min(shortLandscape ? 184 : 360, Math.max(trayMinimum, preferred), timelineSafeMaximum)),
        compactViewport: false,
    };
}

export function musicTrayMaxHeight(width: number, height: number, keyboardInset = 0, headingHeight = MUSIC_EDITOR_SUBMENU_HEADING_HEIGHT): number {
    return musicTransportLayout(width, height, keyboardInset, headingHeight).trayMaxHeight;
}

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
