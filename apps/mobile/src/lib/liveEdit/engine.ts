/* eslint-disable @typescript-eslint/no-require-imports -- generated platform-neutral JS */
import type { LookId } from '../instantLooks';
export type MakeupId = 'foundation' | 'blush' | 'eyeshadow' | 'brows' | 'eyeliner' | 'lashes' | 'lips';
export type MakeupValue = { strength: number; shade: string; shade2?: string; finish?: string; wing?: number; volume?: number };
export type Hair = { strength: number; shade: string; shade2: string; mode: string };
export type Stack = { look: LookId; strength: number; smoothing: number; makeup: Record<MakeupId, MakeupValue>; hair: Hair };
export type HairMask = { width: number; height: number; hair: Float32Array };
export type HairTexture = { width: number; height: number; data: Uint8Array; top: number; span: number };
export const { MAKEUP, SHADES, MAKEUP_PRESETS, rgb } = require('./shared/makeup') as {
    MAKEUP: readonly { id: MakeupId; region: string; blend: string; shades: readonly string[]; defaultStrength: number }[];
    SHADES: Record<string, string>; MAKEUP_PRESETS: Record<string, Stack['makeup']>; rgb: (shade: string) => number[];
};
export const { HAIR_SHADES, HAIR_PRESETS, hairRgb, hairTexture, selectFaceHair } = require('./shared/hair') as {
    HAIR_SHADES: Record<string, string>; HAIR_PRESETS: Record<string, Hair>; hairRgb: (shade: string) => number[];
    hairTexture: (mask: HairMask | null) => HairTexture | null;
    selectFaceHair: (mask: HairMask, points: Float32Array) => HairMask | null;
};
const shared = require('./shared/effects') as { normalize: (input?: Partial<Stack>) => Stack };
// Only S4 controls are accepted. No hidden web-only effects may be saved unrendered.
export function normalizeStack(input: Partial<Stack> = {}): Stack {
    const { look, strength, smoothing, makeup, hair } = shared.normalize(input);
    return { look, strength, smoothing, makeup, hair };
}
export const DEFAULT_STACK = normalizeStack();
export function history(initial = DEFAULT_STACK) {
    let past: Stack[] = [], present = normalizeStack(initial), future: Stack[] = [], beforeDrag: Stack | null = null;
    const equal = (a: Stack, b: Stack) => JSON.stringify(a) === JSON.stringify(b);
    function commit() {
        if (beforeDrag && !equal(beforeDrag, present)) { past = [...past.slice(-49), beforeDrag]; future = []; }
        beforeDrag = null;
    }
    return {
        get value() { return normalizeStack(present); },
        get canUndo() { return past.length > 0; }, get canRedo() { return future.length > 0; },
        begin() { if (!beforeDrag) beforeDrag = normalizeStack(present); },
        commit,
        set(next: Stack) {
            const value = normalizeStack(next); if (equal(value, present)) return;
            if (!beforeDrag) { past = [...past.slice(-49), present]; future = []; }
            present = value;
        },
        undo() { commit(); if (past.length) { future.push(present); present = past.pop()!; } },
        redo() { commit(); if (future.length) { past.push(present); present = future.pop()!; } },
    };
}
