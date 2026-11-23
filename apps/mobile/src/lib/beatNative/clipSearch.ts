// Typed native seam over the shared web clip-search rules. Matching stays in
// one place so drums, MIDI and audio resolve identically on both platforms.
// @ts-ignore shared JavaScript module
import * as searchModule from '../../../../../app/veyrnox/_lib/music/beat/beatClipSearch.mjs';
import type { BeatDoc } from './doc';

export type ClipSearchResult = { trackId: string; regionId: string; label: string };
export type BeatClipSearchResult = ClipSearchResult;

const shared = searchModule as unknown as {
    searchClips(doc: BeatDoc, query: unknown): ClipSearchResult[];
};

export const searchClips = (doc: BeatDoc, query: unknown): ClipSearchResult[] => shared.searchClips(doc, query);

export type LaneRevealGeometry = {
    currentScrollY: number;
    laneWindowY: number;
    workspaceWindowY: number;
    contentHeight: number;
    viewportHeight: number;
    inset?: number;
};

type WindowMeasurement = (x: number, y: number, width: number, height: number) => void;
export type WindowMeasurable = { measureInWindow?(callback: WindowMeasurement): void };
export type MeasureAndRevealLaneInput = {
    lane: WindowMeasurable | null | undefined;
    workspace: WindowMeasurable | null | undefined;
    currentScrollY: number;
    contentHeight: number;
    viewportHeight: number;
    inset?: number;
    isCurrent(): boolean;
    onReveal(y: number): void;
};

/**
 * Convert fresh window-coordinate measurements into the outer workspace's
 * content coordinate. Invalid or unavailable geometry is deliberately a
 * no-op; selecting and horizontally revealing the clip can still succeed.
 */
export function laneRevealScrollY(input: LaneRevealGeometry): number | null {
    const inset = input.inset ?? 16;
    const values = [input.currentScrollY, input.laneWindowY, input.workspaceWindowY,
        input.contentHeight, input.viewportHeight, inset];
    if (!values.every(Number.isFinite) || input.contentHeight <= 0 || input.viewportHeight <= 0 || inset < 0) return null;
    const maximum = Math.max(0, input.contentHeight - input.viewportHeight);
    const target = input.currentScrollY + input.laneWindowY - input.workspaceWindowY - inset;
    return Math.max(0, Math.min(maximum, target));
}

/** Measure both coordinate spaces at invocation time and reveal only while the
 * caller's generation remains current. Missing native refs/callbacks are safe
 * no-ops so clip selection and horizontal reveal remain independent. */
export function measureAndRevealLane(input: MeasureAndRevealLaneInput): void {
    const { lane, workspace } = input;
    if (!lane?.measureInWindow || !workspace?.measureInWindow || !input.isCurrent()) return;
    let laneWindowY: number | undefined;
    let workspaceWindowY: number | undefined;
    let measuredViewportHeight: number | undefined;
    let revealed = false;
    const reveal = () => {
        if (revealed || laneWindowY === undefined || workspaceWindowY === undefined || !input.isCurrent()) return;
        const y = laneRevealScrollY({
            currentScrollY: input.currentScrollY,
            laneWindowY,
            workspaceWindowY,
            contentHeight: input.contentHeight,
            viewportHeight: measuredViewportHeight !== undefined && Number.isFinite(measuredViewportHeight) && measuredViewportHeight > 0
                ? measuredViewportHeight : input.viewportHeight,
            inset: input.inset,
        });
        if (y === null || !input.isCurrent()) return;
        revealed = true;
        try { input.onReveal(y); }
        catch { /* The workspace may unmount between measurement and reveal. */ }
    };
    try {
        lane.measureInWindow((_x, y) => { laneWindowY = y; reveal(); });
        workspace.measureInWindow((_x, y, _width, height) => {
            workspaceWindowY = y; measuredViewportHeight = height; reveal();
        });
    } catch { /* Native measurement can disappear during navigation; selection still succeeds. */ }
}
