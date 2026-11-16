/**
 * Vertical budget for the full (advanced) editor. The screen cannot scroll (the timeline owns drag gestures),
 * so every region must be sized up front: the tool panel gets a guaranteed minimum, the preview shrinks on
 * short phones, and the timeline takes what is left and scrolls vertically inside that bound.
 */
export const TRACK_ROW = 56;
export const TIMELINE_HEADING = 31;
export const TIMELINE_RULER = 32;
/** Never squeeze the timeline below its heading, ruler and one track row. */
export const TIMELINE_MIN = TIMELINE_HEADING + TIMELINE_RULER + TRACK_ROW;
const NAV_HEADER = 44, PROJECT_BAR = 58, COMMAND_STRIP = 51, OPTION_STRIP = 44;
const PREVIEW_PAD = 15, PREVIEW_HEADING = 26, TRANSPORT = 49;
const COMPACT_BELOW = 760, PANEL_SHARE = 0.28, PANEL_FLOOR = 230, PANEL_FLOOR_COMPACT = 200;

export type EditorLayoutBudget = { compact: boolean; previewHeight: number; showPreviewHeading: boolean; panelMin: number; timelineMax: number; timelineScrollMax: number };

export function editorLayoutBudget({ windowHeight, topInset = 0, bottomInset = 0, trackCount }: { windowHeight: number; topInset?: number; bottomInset?: number; trackCount: number }): EditorLayoutBudget {
    const compact = windowHeight < COMPACT_BELOW;
    const previewHeight = compact ? 56 : 72;
    const previewArea = PREVIEW_PAD + (compact ? 0 : PREVIEW_HEADING) + previewHeight + TRANSPORT;
    const chrome = NAV_HEADER + topInset + bottomInset + PROJECT_BAR + COMMAND_STRIP + OPTION_STRIP;
    const panelMin = Math.max(compact ? PANEL_FLOOR_COMPACT : PANEL_FLOOR, Math.round(windowHeight * PANEL_SHARE));
    const content = TIMELINE_HEADING + TIMELINE_RULER + Math.max(1, trackCount) * TRACK_ROW;
    const timelineMax = Math.min(content, Math.max(TIMELINE_MIN, windowHeight - chrome - previewArea - panelMin));
    return { compact, previewHeight, showPreviewHeading: !compact, panelMin, timelineMax, timelineScrollMax: timelineMax - TIMELINE_HEADING };
}
