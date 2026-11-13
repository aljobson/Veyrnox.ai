import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { MATRIX, SMOOTH, MAKEUP_SHADER, HAIR_SHADER } from './shaders';
// Four immutable program sources only. Pictures/shader instances remain per-render.
const allowed = new Set([MATRIX, SMOOTH, MAKEUP_SHADER, HAIR_SHADER]);
const compiled = new Map<string, SkRuntimeEffect>();
export function runtimeEffect(source: string): SkRuntimeEffect {
    if (!allowed.has(source)) throw Error('live-edit-unknown-shader');
    let effect = compiled.get(source);
    if (!effect) {
        effect = Skia.RuntimeEffect.Make(source) ?? undefined;
        if (!effect) throw Error('live-edit-shader-failed');
        compiled.set(source, effect);
    }
    return effect;
}
