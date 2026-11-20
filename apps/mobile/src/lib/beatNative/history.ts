// @ts-ignore shared JavaScript module
import * as shared from '../../../../../app/veyrnox/_lib/music/beat/beatHistory.mjs';
import type { BeatDoc } from './doc';
export type History = { present: BeatDoc; past: { doc: BeatDoc; label: string }[]; future: { doc: BeatDoc; label: string }[] };
export const { createHistory, record, undo, redo, canUndo, canRedo, replacePresent } = shared as {
    createHistory(doc: BeatDoc): History;
    record(history: History, doc: BeatDoc, options?: { label?: string }): History;
    undo(history: History): History;
    redo(history: History): History;
    canUndo(history: History): boolean;
    canRedo(history: History): boolean;
    replacePresent(history: History, doc: BeatDoc): History;
};
export function travel(history: History, direction: 'undo' | 'redo', now = Date.now()): History {
    const next = direction === 'undo' ? undo(history) : redo(history);
    if (next === history) return history;
    return replacePresent(next, { ...next.present, updatedAt: Math.max(history.present.updatedAt + 1, now) });
}
