import { AlphaType, ColorType, FilterMode, MipmapMode, PaintStyle, StrokeJoin, TileMode, processUniforms, type Skia, type SkImage, type SkRuntimeEffect, type SkShader } from '@shopify/react-native-skia';
import { checkPuppetAbort, preparePuppetPixelsBatched, yieldPuppetTask, type PuppetRig } from './puppetPrepare';
import { PUPPET_SKSL, type puppetUniforms } from './puppetSksl';

export const PORTRAIT_WIDTH = 1024, PORTRAIT_HEIGHT = 1536;
const info = { width: PORTRAIT_WIDTH, height: PORTRAIT_HEIGHT, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul };
let effect: SkRuntimeEffect | null | undefined;
export function puppetEffect(skia: typeof Skia) {
    if (effect === undefined) effect = skia.RuntimeEffect.Make(PUPPET_SKSL);
    if (!effect) throw new Error('puppet_shader_failed');
    return effect;
}

export function puppetMask(skia: typeof Skia, rig: PuppetRig): Uint8Array {
    const surface = skia.Surface.Make(PORTRAIT_WIDTH, PORTRAIT_HEIGHT);
    if (!surface) throw new Error('puppet_surface_failed');
    const path = skia.Path.Polygon(rig.head.map(([x, y]) => ({ x, y })), true), paint = skia.Paint();
    let snapshot: SkImage | undefined;
    try {
        const canvas = surface.getCanvas();
        canvas.clear(skia.Color('transparent'));
        paint.setColor(skia.Color('black'));
        paint.setAntiAlias(true);
        canvas.drawPath(path, paint);
        paint.setStyle(PaintStyle.Stroke);
        paint.setStrokeWidth(12);
        paint.setStrokeJoin(StrokeJoin.Round);
        canvas.drawPath(path, paint);
        surface.flush();
        snapshot = surface.makeImageSnapshot();
        const pixels = snapshot.readPixels(0, 0, info);
        if (!pixels) throw new Error('puppet_mask_failed');
        return new Uint8Array(pixels);
    } finally { snapshot?.dispose(); paint.dispose(); path.dispose(); surface.dispose(); }
}

export interface PuppetLayers { plate: SkImage; head: SkImage; lids: number[][]; dispose(): void }
export async function prepareNativePuppet(skia: typeof Skia, bytes: Uint8Array, rig: PuppetRig, signal: AbortSignal): Promise<PuppetLayers> {
    checkPuppetAbort(signal);
    puppetEffect(skia);
    const encoded = skia.Data.fromBytes(bytes);
    let decoded: SkImage | null = null;
    let pixels: Uint8Array;
    try {
        decoded = skia.Image.MakeImageFromEncoded(encoded);
        if (!decoded || decoded.width() !== PORTRAIT_WIDTH || decoded.height() !== PORTRAIT_HEIGHT) throw new Error('puppet_portrait_dimensions');
        const read = decoded.readPixels(0, 0, info);
        if (!read) throw new Error('puppet_decode_failed');
        pixels = new Uint8Array(read);
    } finally { decoded?.dispose(); encoded.dispose(); }
    await yieldPuppetTask();
    checkPuppetAbort(signal);
    const mask = puppetMask(skia, rig);
    await yieldPuppetTask();
    const layers = await preparePuppetPixelsBatched({ ...info, data: pixels }, mask, rig, { signal });
    checkPuppetAbort(signal);
    const makeImage = (bytes: Uint8Array, alphaType: AlphaType) => {
        const data = skia.Data.fromBytes(bytes);
        try {
            const image = skia.Image.MakeImage({ ...info, alphaType }, data, PORTRAIT_WIDTH * 4);
            if (!image) throw new Error('puppet_image_failed');
            return image;
        } finally { data.dispose(); }
    };
    const plate = makeImage(layers.plate, AlphaType.Opaque);
    let head: SkImage;
    try { head = makeImage(layers.head, AlphaType.Premul); }
    catch (error) { plate.dispose(); throw error; }
    let disposed = false;
    return { plate, head, lids: layers.lids, dispose() {
        if (!disposed) { disposed = true; plate.dispose(); head.dispose(); }
    } };
}

// Bind once before ready, using the same uniform packing and child order as <Shader>.
export function validatePuppetShader(skia: typeof Skia, layers: PuppetLayers, uniforms: ReturnType<typeof puppetUniforms>) {
    const children: SkShader[] = [];
    let shader: SkShader | null = null;
    try {
        for (const image of [layers.plate, layers.head]) {
            const child = image.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
            if (!child) throw new Error('puppet_shader_binding_failed');
            children.push(child);
        }
        const source = puppetEffect(skia);
        shader = source.makeShaderWithChildren(processUniforms(source, uniforms), children);
        if (!shader) throw new Error('puppet_shader_binding_failed');
    } finally { shader?.dispose(); children.forEach(child => child.dispose()); }
}
