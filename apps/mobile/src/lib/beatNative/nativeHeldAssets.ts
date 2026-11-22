import type { BeatAsset } from './doc';
// @ts-ignore shared release-authority rules; this native store only retains stable signing identities.
import * as availability from '../../../../../app/veyrnox/_lib/music/beat/beatAssetAvailability.mjs';

export type NativeHeldAsset = Pick<BeatAsset, 'source' | 'ref'>;
export type NativeHeldAssetState =
    | Readonly<{ status: 'ready' }>
    | Readonly<{ status: 'held'; reason: 'Held for review'; permanent: true }>;
export type NativeHeldAssets = {
    state(asset: NativeHeldAsset, bpm?: number): NativeHeldAssetState;
    isHeld(asset: NativeHeldAsset): boolean;
    markHeld(asset: NativeHeldAsset): void;
    assertAvailable(asset: NativeHeldAsset): void;
    retry(asset?: NativeHeldAsset): void;
    reset(): void;
};

const { assetSigningPath, isHeldError } = availability as unknown as {
    assetSigningPath(asset: NativeHeldAsset): string | null;
    isHeldError(error: unknown): boolean;
};
const READY = Object.freeze({ status: 'ready' } as const);
const HELD = Object.freeze({ status: 'held', reason: 'Held for review', permanent: true } as const);

export function nativeHeldError(): Error & { status: 404; code: 'held' } {
    return Object.assign(new Error('Held for review'), { status: 404 as const, code: 'held' as const });
}

export function recordNativeHeldError(store: NativeHeldAssets, asset: NativeHeldAsset, error: unknown): boolean {
    if (!isHeldError(error)) return false;
    store.markHeld(asset);
    return true;
}

export function createNativeHeldAssets(): NativeHeldAssets {
    const held = new Set<string>();
    const key = (asset: NativeHeldAsset) => assetSigningPath(asset);
    const isHeld = (asset: NativeHeldAsset) => {
        const path = key(asset);
        return path !== null && held.has(path);
    };
    const markHeld = (asset: NativeHeldAsset) => {
        const path = key(asset);
        if (path !== null) held.add(path);
    };
    const retry = (asset?: NativeHeldAsset) => {
        if (!asset) { held.clear(); return; }
        const path = key(asset);
        if (path !== null) held.delete(path);
    };
    return {
        state: (asset) => isHeld(asset) ? HELD : READY,
        isHeld,
        markHeld,
        assertAvailable: (asset) => { if (isHeld(asset)) throw nativeHeldError(); },
        retry,
        reset: () => held.clear(),
    };
}
