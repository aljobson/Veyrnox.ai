// Web-only S5a extension: leave the byte-synced mobile S4 engine unchanged.
import { DEFAULTS as BASE, normalize as normalizeBase } from '../../../../packages/live-edit/effects.js';
import { WIG_DEFAULTS, normalizeWig } from '../../../../packages/live-edit/wigFit.js';
export const DEFAULTS = Object.freeze({ ...BASE, wig: WIG_DEFAULTS });
export const normalize = (settings = {}) => ({ ...normalizeBase(settings), wig: normalizeWig(settings.wig) });
export function createHistory(initial = DEFAULTS) {
    let past = [], present = normalize(initial), future = [];
    return {
        get value() { return structuredClone(present); },
        get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
        set(next) { const value = normalize(next); if (JSON.stringify(value) === JSON.stringify(present)) return; past = [...past.slice(-99), present]; present = value; future = []; },
        undo() { if (past.length) { future.push(present); present = past.pop(); } },
        redo() { if (future.length) { past.push(present); present = future.pop(); } },
    };
}
