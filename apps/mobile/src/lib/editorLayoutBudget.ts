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
const PREVIEW_PAD = 15, PREVIEW_HEADING = 26;
// EditorTransport has a 44pt control row and a separate 44pt tappable timecode row.
export const TRANSPORT_HEIGHT = 88;
const COMPACT_BELOW = 760, WIDE_SHORT_MIN_WIDTH = 560, WIDE_SHORT_MAX_HEIGHT = 500, AX_FONT_SCALE = 1.3;
const PANEL_SHARE = 0.28, PANEL_SHARE_COMPACT = 0.25, PANEL_FLOOR = 230, PANEL_FLOOR_COMPACT = 170;

export type EditorLayoutBudget = { compact: boolean; wideShort: boolean; previewHeight: number; showPreviewHeading: boolean; panelMin: number; timelineMax: number; timelineScrollMax: number };

export function editorLayoutBudget({ windowWidth = 390, windowHeight, fontScale = 1, topInset = 0, bottomInset = 0, trackCount }:
    { windowWidth?: number; windowHeight: number; fontScale?: number; topInset?: number; bottomInset?: number; trackCount: number }): EditorLayoutBudget {
    // Landscape phones use three adjacent panes (preview, timeline, inspector). At Accessibility text sizes the panes
    // remain adjacent so nothing is pushed below the short viewport, while the preview yields height to growing controls.
    const wideShort = windowWidth >= WIDE_SHORT_MIN_WIDTH && windowHeight <= WIDE_SHORT_MAX_HEIGHT;
    const compact = !wideShort && windowHeight < COMPACT_BELOW;
    const chrome = NAV_HEADER + topInset + bottomInset + PROJECT_BAR + COMMAND_STRIP + OPTION_STRIP;
    if (wideShort) {
        const paneHeight = Math.max(TIMELINE_MIN, windowHeight - chrome);
        const previewHeight = fontScale >= AX_FONT_SCALE ? 56 : Math.max(56, paneHeight - PREVIEW_PAD - TRANSPORT_HEIGHT);
        return { compact: true, wideShort: true, previewHeight, showPreviewHeading: false, panelMin: 0,
            timelineMax: paneHeight, timelineScrollMax: paneHeight - TIMELINE_HEADING };
    }
    const previewHeight = compact ? 56 : 72;
    const previewArea = PREVIEW_PAD + (compact ? 0 : PREVIEW_HEADING) + previewHeight + TRANSPORT_HEIGHT;
    const panelMin = Math.max(compact ? PANEL_FLOOR_COMPACT : PANEL_FLOOR, Math.round(windowHeight * (compact ? PANEL_SHARE_COMPACT : PANEL_SHARE)));
    const content = TIMELINE_HEADING + TIMELINE_RULER + Math.max(1, trackCount) * TRACK_ROW;
    const timelineMax = Math.min(content, Math.max(TIMELINE_MIN, windowHeight - chrome - previewArea - panelMin));
    return { compact, wideShort: false, previewHeight, showPreviewHeading: !compact, panelMin, timelineMax, timelineScrollMax: timelineMax - TIMELINE_HEADING };
}
