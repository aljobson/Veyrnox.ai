// Typed boundary for the unchanged upstream behaviour classes emitted by the sync script.
import type { WobnimoState } from './veyCharacterChoice';
export interface Pose {
    root: Float32Array; minScale: number; lift: number;
    channels: Record<string, number>; weights: Record<string, number>;
    expression: string; faceA: number[]; faceB: number[]; faceC: number[]; faceD: number[];
    glow: number[]; exposure: number; events: string[];
}
export class Brain {
    constructor(motion: Record<string, number>, seed: number);
    state: WobnimoState;
    pose: Pose;
    setState(state: WobnimoState): void;
    update(dt: number): void;
}
export class Rig {
    constructor(bones: unknown[], acting: unknown[]);
    inverse: Float32Array;
    update(root: Float32Array, channels: Record<string, number>, weights: Record<string, number>, time: number, dt: number): void;
}
export class Fx {
    constructor(character: unknown, random: () => number);
    a: Float32Array; b: Float32Array; c: Float32Array; count: number;
    update(dt: number, pose: Pose, rig: Rig): void;
}
export function random(seed: number): () => number;
