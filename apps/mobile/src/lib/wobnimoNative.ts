import type { Skia, SkImage, SkRuntimeEffect, SkShader } from '@shopify/react-native-skia';
import { Brain, Rig, Fx, random } from './wobnimoEngine.generated';
import { WOBNIMO_DATA } from './wobnimoData.generated';
import { WOBNIMO_PROGRAMS } from './wobnimoPrograms.generated';
import type { WobnimoId, WobnimoState } from './veyCharacterChoice';

type Values = Record<string, number | readonly number[] | Float32Array>;

export function wobnimoTarget(width: number, density: number, quality = 1) {
    if (!(width > 0) || !Number.isFinite(width) || !(density > 0) || !Number.isFinite(density)) {
        throw new Error('Invalid Wobnimo render dimensions');
    }
    const size = Math.max(1, Math.round(width * Math.min(density, 2) * Math.max(0.55, Math.min(quality, 1))));
    return { size, scale: size / width };
}

// Upstream $e.adapt, sampled on every RAF (not the throttled 30fps draw interval).
export class WobnimoQuality {
    value = 1;
    private slow = 0;
    private fast = 0;
    adapt(milliseconds: number) {
        this.slow = milliseconds > 22 && milliseconds < 200 ? this.slow + 1 : Math.max(0, this.slow - 1);
        this.fast = milliseconds < 17.5 ? this.fast + 1 : 0;
        if (this.slow > 20) { this.value = Math.max(0.55, this.value * 0.85); this.slow = 0; }
        else if (this.fast > 120 && this.value < 1) { this.value = Math.min(1, this.value * 1.08); this.fast = 0; }
    }
}

// Skia coordinates are top-left pixel centres; WebGL's fragment coordinates are bottom-left.
export function wobnimoFragmentPoint(x: number, y: number, size: number) {
    return [x, size - y];
}

export class WobnimoEngine {
    private readonly data;
    private readonly brain;
    private readonly rig;
    private readonly fx;
    private time = 0;
    private stillFrames = 0;
    private reduced = false;

    constructor(character: WobnimoId, state: WobnimoState, seed = Math.random()) {
        this.data = WOBNIMO_DATA[character];
        if (!this.data) throw new Error(`Unknown mascot: ${character}`);
        this.brain = new Brain(this.data.spec.motion, seed);
        this.brain.setState(state);
        this.rig = new Rig(this.data.bones, this.data.acting);
        this.fx = new Fx(this.data, random(seed + 0.37));
    }

    configure(state: WobnimoState, reduced: boolean) {
        if (this.brain.state !== state || this.reduced !== reduced) this.stillFrames = 0;
        this.brain.setState(state);
        this.reduced = reduced;
    }

    get settled() { return this.reduced && this.stillFrames >= 2; }

    frame(size: number, seconds: number): Values {
        // Match Mascot.tick: settle two static frames when reduced motion is requested.
        const dt = Math.min(Math.max(seconds, 0), 1 / 20);
        if (this.reduced) {
            for (let i = 0; i < 90; i++) this.brain.update(1 / 60);
            this.stillFrames++;
        } else {
            this.brain.update(dt);
            this.time += dt;
        }
        const time = this.reduced ? 0 : this.time;
        const pose = this.brain.pose;
        this.rig.update(pose.root, pose.channels, pose.weights, time, this.reduced ? 0 : dt);
        if (this.reduced) this.fx.count = 0;
        else this.fx.update(dt, pose, this.rig);
        pose.events.length = 0;
        const spec = this.data.spec;
        return {
            uResolution: [size, size], uTime: time,
            uCamera: [spec.frame.target, spec.frame.radius / 0.2, 0.2, 0.1],
            uBound: [0, spec.bound.y + pose.lift, 0, spec.bound.radius],
            uBones: this.rig.inverse, uScaleFix: pose.minScale,
            uFaceA: pose.faceA, uFaceB: pose.faceB, uFaceC: pose.faceC, uFaceD: pose.faceD,
            uGlow: pose.glow, uShadow: [0.05, 0.06, 0.12], uFloor: 1, uLift: pose.lift,
            uExposure: pose.exposure, uAlbedo: this.data.albedo,
            uGlowPool: 'glowPool' in spec ? spec.glowPool : 0,
            uFxA: this.fx.a, uFxB: this.fx.b, uFxC: this.fx.c, uFxCount: this.fx.count,
        };
    }
}

export function wobnimoUniforms(character: WobnimoId, effect: SkRuntimeEffect, values: Values): number[] {
    const layout = WOBNIMO_PROGRAMS[character].uniforms;
    if (effect.getUniformCount() !== layout.length) throw new Error('Wobnimo uniform count mismatch');
    const packed: number[] = [];
    layout.forEach(({ name, size, integer }, i) => {
        const actual = effect.getUniform(i);
        if (effect.getUniformName(i) !== name || actual.columns * actual.rows !== size || actual.isInteger !== integer) {
            throw new Error(`Wobnimo uniform layout mismatch: ${name}`);
        }
        const value = values[name];
        const numbers = typeof value === 'number' ? [value] : Array.from(value ?? []);
        if (numbers.length !== size || numbers.some(n => !Number.isFinite(n))) throw new Error(`Invalid Wobnimo uniform: ${name}`);
        packed.push(...numbers);
    });
    if (effect.getUniformFloatCount() !== packed.length) throw new Error('Wobnimo uniform size mismatch');
    return packed;
}

// Effects live for the Skia runtime's lifetime (at most the 20 selectable characters).
// Separate runtimes, such as CanvasKit in tests, never share native handles.
const effects = new WeakMap<typeof Skia, Map<WobnimoId, SkRuntimeEffect>>();
function cachedEffect(skia: typeof Skia, character: WobnimoId) {
    let cache = effects.get(skia);
    if (!cache) { cache = new Map(); effects.set(skia, cache); }
    let effect = cache.get(character);
    if (!effect) {
        effect = skia.RuntimeEffect.Make(WOBNIMO_PROGRAMS[character].source) ?? undefined;
        if (!effect) throw new Error(`Wobnimo shader failed: ${character}`);
        cache.set(character, effect);
    }
    return effect;
}

// Same renderer used on device and in the CanvasKit proofs. A dedicated physical-pixel
// target avoids tying shader coordinates to the display Canvas's logical point scale.
export function createWobnimoRenderer(skia: typeof Skia, character: WobnimoId, size: number) {
    const effect = cachedEffect(skia, character);
    const initialSurface = skia.Surface.MakeOffscreen(size, size, { colorSpace: 'srgb' });
    if (!initialSurface) throw new Error('Wobnimo surface unavailable');
    let surface = initialSurface;
    try {
        const paint = skia.Paint();
        let disposed = false;
        return {
            resize(nextSize: number) {
                if (disposed) throw new Error('Wobnimo renderer disposed');
                if (nextSize === size) return;
                const next = skia.Surface.MakeOffscreen(nextSize, nextSize, { colorSpace: 'srgb' });
                if (!next) throw new Error('Wobnimo surface unavailable');
                surface.dispose(); surface = next; size = nextSize;
            },
            draw(values: Values): SkImage {
                if (disposed) throw new Error('Wobnimo renderer disposed');
                let shader: SkShader | undefined;
                try {
                    shader = effect.makeShader(wobnimoUniforms(character, effect, values));
                    paint.setShader(shader);
                    const canvas = surface.getCanvas();
                    canvas.clear(skia.Color('transparent'));
                    canvas.drawPaint(paint);
                    surface.flush();
                    const texture = surface.makeImageSnapshot();
                    try {
                        // The display Canvas can use a different GPU context/thread.
                        const raster = texture.makeNonTextureImage();
                        if (!raster) throw new Error('Wobnimo image readback failed');
                        return raster;
                    } finally { texture.dispose(); }
                } finally {
                    paint.setShader(null);
                    shader?.dispose();
                }
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                paint.dispose(); surface.dispose();
            },
        };
    } catch (error) { surface.dispose(); throw error; }
}
