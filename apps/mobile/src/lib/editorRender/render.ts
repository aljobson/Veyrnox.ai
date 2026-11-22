import {
    AlphaType, BlendMode, BlurStyle, ColorType, FilterMode, MipmapMode, TileMode,
    type SkCanvas, type SkImage, type Skia,
} from '@shopify/react-native-skia';
import {
    STATIC_PREVIEW_BLENDS, STATIC_PREVIEW_LIMITS,
    type StaticPreviewBackground, type StaticPreviewBlend, type StaticPreviewLayer, type StaticPreviewMask,
    type StaticPreviewImageResult, type StaticPreviewPlan, type StaticPreviewResult, type StaticPreviewUnsupportedFeature,
} from './types';

type Disposable = { dispose(): void };
const COLOR = /^#[0-9a-fA-F]{6}$/;
const finite = (value: number) => Number.isFinite(value);
const NO_ERROR = Symbol('no-error');
const blendModes: Record<StaticPreviewBlend, BlendMode> = {
    'source-over': BlendMode.SrcOver,
    multiply: BlendMode.Multiply,
    screen: BlendMode.Screen,
    overlay: BlendMode.Overlay,
    darken: BlendMode.Darken,
    lighten: BlendMode.Lighten,
    difference: BlendMode.Difference,
};

class Scope {
    private readonly values: Disposable[] = [];
    own<T extends Disposable>(value: T): T { this.values.push(value); return value; }
    dispose() {
        let first: unknown = NO_ERROR;
        for (const value of this.values.reverse()) {
            try { value.dispose(); } catch (error) { if (first === NO_ERROR) first = error; }
        }
        this.values.length = 0;
        if (first !== NO_ERROR) throw first;
    }
}

function withScope<T>(work: (scope: Scope) => T): T {
    const scope = new Scope(); let primary: unknown = NO_ERROR;
    try { return work(scope); }
    catch (error) { primary = error; throw error; }
    finally {
        try { scope.dispose(); }
        catch (cleanup) { if (primary === NO_ERROR) throw cleanup; }
    }
}

const between = (value: number, minimum: number, maximum: number) => finite(value) && value >= minimum && value <= maximum;

function issues(plan: StaticPreviewPlan): string[] {
    const found: string[] = [];
    if (!Number.isSafeInteger(plan.width) || plan.width < 1 || plan.width > STATIC_PREVIEW_LIMITS.maxWidth
        || !Number.isSafeInteger(plan.height) || plan.height < 1 || plan.height > STATIC_PREVIEW_LIMITS.maxHeight
        || plan.width * plan.height > STATIC_PREVIEW_LIMITS.maxPixels) found.push('invalid-output-size');
    if (!COLOR.test(plan.background)) found.push('invalid-timeline-background');
    if (!Array.isArray(plan.layers) || plan.layers.length > STATIC_PREVIEW_LIMITS.maxLayers) found.push('invalid-layer-count');
    for (const layer of plan.layers) {
        const crop = layer.crop, transform = layer.transform, mask = layer.mask;
        if (!layer.id || !Number.isSafeInteger(layer.trackOrder) || !Number.isSafeInteger(layer.clipOrder)) found.push('invalid-layer-identity');
        if (layer.image && (layer.image.width() < 1 || layer.image.height() < 1)) found.push('invalid-source-image');
        if (!between(crop.x, 0, 1) || !between(crop.y, 0, 1) || !between(crop.width, .05, 1) || !between(crop.height, .05, 1)
            || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) found.push('invalid-crop');
        if (!['contain', 'cover'].includes(layer.fit) || !(STATIC_PREVIEW_BLENDS as readonly string[]).includes(layer.blend)) found.push('invalid-draw-mode');
        if (!between(transform.x, -2, 3) || !between(transform.y, -2, 3) || !between(transform.scale, .05, 8)
            || !between(transform.rotation, -360, 360) || !between(transform.opacity, 0, 1)
            || typeof transform.flipX !== 'boolean' || typeof transform.flipY !== 'boolean') found.push('invalid-transform');
        if (mask && (!between(mask.x, -1, 2) || !between(mask.y, -1, 2) || !between(mask.width, .05, 2) || !between(mask.height, .05, 2)
            || !between(mask.rotation, -360, 360) || !between(mask.feather, 0, .25) || typeof mask.inverted !== 'boolean'
            || !['circle', 'rounded', 'horizontal', 'vertical'].includes(mask.shape))) found.push('invalid-mask');
        if (layer.background.type !== 'none' && !COLOR.test(layer.background.color)) found.push('invalid-clip-background');
        if (layer.background.type === 'blur' && (!finite(layer.background.blur) || layer.background.blur < 0 || layer.background.blur > 60)) found.push('invalid-clip-background');
    }
    return [...new Set(found)];
}

function unsupported(plan: StaticPreviewPlan): StaticPreviewUnsupportedFeature[] {
    const values = [...(plan.unsupported ?? []), ...plan.layers.flatMap(layer => layer.unsupported ?? [])];
    for (const layer of plan.layers) {
        if (!layer.image) values.push('missing-source-image');
        if (layer.background.type === 'image' && !layer.background.image) values.push('missing-background-image');
    }
    return [...new Set(values)].sort();
}

function sourceRect(image: SkImage, crop: StaticPreviewLayer['crop']) {
    return { x: image.width() * crop.x, y: image.height() * crop.y, width: image.width() * crop.width, height: image.height() * crop.height };
}

function fittedSize(width: number, height: number, sourceWidth: number, sourceHeight: number, fit: StaticPreviewLayer['fit']) {
    const factor = (fit === 'cover' ? Math.max : Math.min)(width / sourceWidth, height / sourceHeight);
    return { width: sourceWidth * factor, height: sourceHeight * factor };
}

function withLayerTransform(canvas: SkCanvas, plan: StaticPreviewPlan, layer: StaticPreviewLayer, size: { width: number; height: number }, draw: () => void) {
    const transform = layer.transform;
    canvas.save();
    try {
        canvas.translate(plan.width * transform.x, plan.height * transform.y);
        canvas.rotate(transform.rotation, 0, 0);
        canvas.scale(transform.scale * (transform.flipX ? -1 : 1), transform.scale * (transform.flipY ? -1 : 1));
        draw();
    } finally { canvas.restore(); }
}

function maskPath(skia: typeof Skia, mask: StaticPreviewMask, size: { width: number; height: number }) {
    const rect = { x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height };
    if (mask.shape === 'circle') return skia.Path.Oval(rect);
    if (mask.shape === 'rounded') return skia.Path.RRect(skia.RRectXY(rect, Math.min(size.width, size.height) * .15, Math.min(size.width, size.height) * .15));
    return skia.Path.Rect(rect);
}

function applyMask(skia: typeof Skia, plan: StaticPreviewPlan, layer: StaticPreviewLayer,
    size: { width: number; height: number }, layerCanvas: SkCanvas) {
    const mask = layer.mask;
    if (!mask) return;
    withScope(maskScope => {
        const surface = maskScope.own(skia.Surface.Make(plan.width, plan.height) ?? (() => { throw Error('editor-static-surface'); })());
        const canvas = surface.getCanvas(), paint = maskScope.own(skia.Paint());
        canvas.clear(skia.Color(mask.inverted ? '#ffffff' : '#00000000'));
        paint.setAntiAlias(true); paint.setColor(skia.Color('#ffffff'));
        if (mask.inverted) paint.setBlendMode(BlendMode.Clear);
        const sigma = mask.feather * Math.min(size.width, size.height);
        if (sigma > 0) paint.setMaskFilter(maskScope.own(skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, true)));
        withLayerTransform(canvas, plan, layer, size, () => {
            canvas.translate(-size.width / 2 + mask.x * size.width, -size.height / 2 + mask.y * size.height);
            canvas.rotate(mask.rotation, 0, 0);
            const path = maskScope.own(maskPath(skia, mask, { width: size.width * mask.width, height: size.height * mask.height }));
            canvas.drawPath(path, paint);
        });
        surface.flush();
        const image = maskScope.own(surface.makeImageSnapshot()), composite = maskScope.own(skia.Paint());
        composite.setBlendMode(BlendMode.DstIn); layerCanvas.drawImage(image, 0, 0, composite);
    });
}

function drawCover(canvas: SkCanvas, image: SkImage, crop: StaticPreviewLayer['crop'], width: number, height: number,
    paint: ReturnType<typeof Skia.Paint>, pad = 0) {
    const src = sourceRect(image, crop), size = fittedSize(width + pad * 2, height + pad * 2, src.width, src.height, 'cover');
    canvas.drawImageRectOptions(image, src, { x: (width - size.width) / 2, y: (height - size.height) / 2, ...size }, FilterMode.Linear, MipmapMode.None, paint);
}

function drawBackground(skia: typeof Skia, scope: Scope, canvas: SkCanvas, plan: StaticPreviewPlan, layer: StaticPreviewLayer,
    value: StaticPreviewBackground) {
    if (value.type === 'none') return;
    const paint = scope.own(skia.Paint()); paint.setAlphaf(layer.transform.opacity); paint.setColor(skia.Color(value.color));
    canvas.drawRect({ x: 0, y: 0, width: plan.width, height: plan.height }, paint);
    const image = value.type === 'blur' ? layer.image : value.type === 'image' ? value.image : undefined;
    if (!image) return;
    const crop = value.type === 'blur' ? layer.crop : { x: 0, y: 0, width: 1, height: 1 };
    if (value.type === 'blur' && value.blur > 0) {
        paint.setImageFilter(scope.own(skia.ImageFilter.MakeBlur(value.blur * plan.height / 720, value.blur * plan.height / 720, TileMode.Clamp)));
    }
    const pad = value.type === 'blur' ? value.blur * plan.height / 720 * 3 : 0;
    drawCover(canvas, image, crop, plan.width, plan.height, paint, pad);
}

function drawLayer(skia: typeof Skia, output: SkCanvas, plan: StaticPreviewPlan, layer: StaticPreviewLayer) {
    withScope(scope => {
        drawBackground(skia, scope, output, plan, layer, layer.background);
        const image = layer.image!;
        const src = sourceRect(image, layer.crop), size = fittedSize(plan.width, plan.height, src.width, src.height, layer.fit);
        const surface = scope.own(skia.Surface.Make(plan.width, plan.height) ?? (() => { throw Error('editor-static-surface'); })());
        const canvas = surface.getCanvas(), paint = scope.own(skia.Paint());
        canvas.clear(skia.Color('#00000000')); paint.setAntiAlias(true);
        withLayerTransform(canvas, plan, layer, size, () => canvas.drawImageRectOptions(image, src,
            { x: -size.width / 2, y: -size.height / 2, ...size }, FilterMode.Linear, MipmapMode.None, paint));
        applyMask(skia, plan, layer, size, canvas);
        surface.flush();
        const snapshot = scope.own(surface.makeImageSnapshot()), composite = scope.own(skia.Paint());
        composite.setAlphaf(layer.transform.opacity); composite.setBlendMode(blendModes[layer.blend]);
        output.drawImage(snapshot, 0, 0, composite);
    });
}

/**
 * Render the supported static subset without a CPU readback. Plan images stay caller-owned. On
 * success the returned snapshot transfers to the caller, who must call `image.dispose()` once.
 */
export function renderStaticPreviewImage(skia: typeof Skia, plan: StaticPreviewPlan): StaticPreviewImageResult {
    const invalid = issues(plan); if (invalid.length) return { ok: false, code: 'invalid-plan', issues: invalid };
    const blocked = unsupported(plan); if (blocked.length) return { ok: false, code: 'unsupported', features: blocked };
    let output: SkImage | undefined;
    try {
        return withScope(scope => {
            const surface = scope.own(skia.Surface.Make(plan.width, plan.height) ?? (() => { throw Error('editor-static-surface'); })());
            const canvas = surface.getCanvas(); canvas.clear(skia.Color(plan.background));
            const ordered = plan.layers.map((layer, index) => ({ layer, index })).sort((a, b) => a.layer.trackOrder - b.layer.trackOrder
                || a.layer.clipOrder - b.layer.clipOrder || a.index - b.index);
            for (const { layer } of ordered) drawLayer(skia, canvas, plan, layer);
            surface.flush(); output = surface.makeImageSnapshot();
            return { ok: true, width: plan.width, height: plan.height, image: output };
        });
    } catch (error) {
        // A snapshot created before output-surface cleanup failed never transfers to the caller.
        try { output?.dispose(); } catch { /* Preserve the primary render/cleanup failure. */ }
        throw error;
    }
}

/** Render to tightly packed, unpremultiplied RGBA8 and dispose the intermediate output image. */
export function renderStaticPreviewRgba(skia: typeof Skia, plan: StaticPreviewPlan): StaticPreviewResult {
    const rendered = renderStaticPreviewImage(skia, plan);
    if (!rendered.ok) return rendered;
    return withScope(scope => {
        const image = scope.own(rendered.image);
        const pixels = image.readPixels(0, 0, {
            width: rendered.width, height: rendered.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul,
        });
        if (!pixels || pixels.length !== rendered.width * rendered.height * 4) throw Error('editor-static-readback');
        return { ok: true, width: rendered.width, height: rendered.height, rgba: new Uint8Array(pixels) };
    });
}
