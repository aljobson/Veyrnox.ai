/* eslint-disable @typescript-eslint/no-require-imports -- generated platform-neutral JS */
import type { LookId } from '../instantLooks';
export type MakeupId = 'foundation' | 'blush' | 'eyeshadow' | 'brows' | 'eyeliner' | 'lashes' | 'lips';
export type MakeupValue = { strength: number; shade: string; shade2?: string; finish?: string; wing?: number; volume?: number };
export type Hair = { strength: number; shade: string; shade2: string; mode: string };
export type WigId = 'pixie' | 'bob' | 'waves' | 'curls' | 'long' | 'braids';
export type Wig3dId = '3d-pixie' | '3d-bob' | '3d-long' | '3d-fringe';
export type Wig = { style: WigId | Wig3dId | 'none'; size: number; offset: number; strength: number };
export type Stack = { look: LookId; strength: number; smoothing: number; makeup: Record<MakeupId, MakeupValue>; hair: Hair; wig: Wig };
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
// 3D wigs (S9) are accepted here; the shared 2D normalizer still only knows the 2D ids, so this wraps it exactly like the web does.
const wig3dShared = require('./shared/wig3d') as { WIGS_3D: readonly { id: Wig3dId }[]; isWig3d(style: unknown): boolean; normalizeWigWeb(value?: Partial<Wig>): Wig };
export const normalizeWig: (value?: Partial<Wig>) => Wig = wig3dShared.normalizeWigWeb;
export const WIG3D_IDS = wig3dShared.WIGS_3D.map(wig => wig.id);
export const isWig3d = (style: unknown): style is Wig3dId => wig3dShared.isWig3d(style);
export const WIG_IDS = (require('./shared/wigs') as { WIGS: readonly { id: WigId }[] }).WIGS.map(wig => wig.id);
export const WIG_RANGE = { size: [0.75, 1.3], offset: [-0.15, 0.15] } as const; // the same clamps normalizeWig applies
const shared = require('./shared/effects') as { normalize: (input?: Partial<Stack>) => Stack };
// Only the controls this screen renders are accepted. No hidden web-only effects (stickers, tone curves) may be saved unrendered.
export function normalizeStack(input: Partial<Stack> = {}): Stack {
    const { look, strength, smoothing, makeup, hair } = shared.normalize(input);
    return { look, strength, smoothing, makeup, hair, wig: normalizeWig(input.wig) };
}
const LUMA = [0.2126, 0.7152, 0.0722] as const;
/**
 * Luminance-preserving tint as a 4x5 colour matrix: the wig keeps its own light and shade and takes the shade's hue.
 * A matrix leaves alpha alone, so transparent pixels around the wig are never tinted (a blend-mode filter would).
 */
export function tintMatrix(rgb: number[], amount: number): number[] {
    const k = Math.max(0, Math.min(1, amount)), light = LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2] || 1;
    const row = (channel: number) => { const gain = Math.min(3, rgb[channel] / light); return LUMA.map((c, i) => (i === channel ? 1 - k : 0) + k * gain * c); };
    return [...row(0), 0, 0, ...row(1), 0, 0, ...row(2), 0, 0, 0, 0, 0, 1, 0];
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
