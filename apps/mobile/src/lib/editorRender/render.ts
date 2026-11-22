import {
    AlphaType, BlendMode, BlurStyle, ColorType, FilterMode, MipmapMode, TileMode,
    type SkCanvas, type SkImage, type Skia,
} from '@shopify/react-native-skia';
import {
    STATIC_PREVIEW_BLENDS, STATIC_PREVIEW_LIMITS,
    type StaticPreviewBackground, type StaticPreviewBlend, type StaticPreviewFilter, type StaticPreviewLayer, type StaticPreviewMask,
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

function filterGeometry(plan: StaticPreviewPlan, filter: StaticPreviewFilter) {
    const sigma = filter.blur * plan.height / plan.referenceHeight, outset = Math.ceil(sigma * 3);
    return { sigma, outset, width: plan.width + outset * 2, height: plan.height + outset * 2 };
}

function issues(plan: StaticPreviewPlan): string[] {
    const found: string[] = [];
    if (!Number.isSafeInteger(plan.width) || plan.width < 1 || plan.width > STATIC_PREVIEW_LIMITS.maxWidth
        || !Number.isSafeInteger(plan.height) || plan.height < 1 || plan.height > STATIC_PREVIEW_LIMITS.maxHeight
        || plan.width * plan.height > STATIC_PREVIEW_LIMITS.maxPixels) found.push('invalid-output-size');
    const validReference = Number.isSafeInteger(plan.referenceHeight) && plan.referenceHeight >= 2 && plan.referenceHeight <= 3840;
    if (!validReference) found.push('invalid-reference-height');
    if (!COLOR.test(plan.background)) found.push('invalid-timeline-background');
    if (!Array.isArray(plan.layers) || plan.layers.length > STATIC_PREVIEW_LIMITS.maxLayers) found.push('invalid-layer-count');
    for (const layer of plan.layers) {
        const crop = layer.crop, transform = layer.transform, filter = layer.filter, mask = layer.mask;
        if (!layer.id || !Number.isSafeInteger(layer.trackOrder) || !Number.isSafeInteger(layer.clipOrder)) found.push('invalid-layer-identity');
        if (layer.image && (layer.image.width() < 1 || layer.image.height() < 1)) found.push('invalid-source-image');
        if (!between(crop.x, 0, 1) || !between(crop.y, 0, 1) || !between(crop.width, .05, 1) || !between(crop.height, .05, 1)
            || crop.x + crop.width > 1.000001 || crop.y + crop.height > 1.000001) found.push('invalid-crop');
        if (!['contain', 'cover'].includes(layer.fit) || !(STATIC_PREVIEW_BLENDS as readonly string[]).includes(layer.blend)) found.push('invalid-draw-mode');
        if (!between(transform.x, -2, 3) || !between(transform.y, -2, 3) || !between(transform.scale, .05, 8)
            || !between(transform.rotation, -360, 360) || !between(transform.opacity, 0, 1)
            || typeof transform.flipX !== 'boolean' || typeof transform.flipY !== 'boolean') found.push('invalid-transform');
        if (!filter || !between(filter.brightness, 0, 3) || !between(filter.contrast, 0, 3)
            || !between(filter.saturate, 0, 3) || !between(filter.hue, -180, 180)
            || !between(filter.blur, 0, 30)) found.push('invalid-filter');
        else if (validReference) {
            const geometry = filterGeometry(plan, filter);
            if (!finite(geometry.sigma) || geometry.outset > STATIC_PREVIEW_LIMITS.maxFilterOutset
                || geometry.width * geometry.height > STATIC_PREVIEW_LIMITS.maxLayerPixels) found.push('invalid-filter-surface');
        }
        if (mask && (!between(mask.x, -1, 2) || !between(mask.y, -1, 2) || !between(mask.width, .05, 2) || !between(mask.height, .05, 2)
            || !between(mask.rotation, -360, 360) || !between(mask.feather, 0, .25) || typeof mask.inverted !== 'boolean'
            || !['circle', 'rounded', 'horizontal', 'vertical'].includes(mask.shape))) found.push('invalid-mask');
        if (layer.background.type !== 'none' && !COLOR.test(layer.background.color)) found.push('invalid-clip-background');
        if (layer.background.type === 'blur' && (!finite(layer.background.blur) || layer.background.blur < 0 || layer.background.blur > 60)) found.push('invalid-clip-background');
    }
    return [...new Set(found)];
}

const colourMatrix = (red: readonly number[], green: readonly number[], blue: readonly number[]) => [
    ...red, ...green, ...blue,
    0, 0, 0, 1, 0,
];

const brightnessMatrix = (value: number) => colourMatrix(
    [value, 0, 0, 0, 0], [0, value, 0, 0, 0], [0, 0, value, 0, 0],
);

const contrastMatrix = (value: number) => {
    // CSS contrast pivots unpremultiplied sRGB at 0.5. Skia matrix translations are normalized.
    const offset = .5 * (1 - value);
    return colourMatrix([value, 0, 0, 0, offset], [0, value, 0, 0, offset], [0, 0, value, 0, offset]);
};

const saturationMatrix = (value: number) => {
    const inverse = 1 - value, red = .213 * inverse, green = .715 * inverse, blue = .072 * inverse;
    return colourMatrix(
        [red + value, green, blue, 0, 0],
        [red, green + value, blue, 0, 0],
        [red, green, blue + value, 0, 0],
    );
};

const hueMatrix = (degrees: number) => {
    const radians = degrees * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
    return colourMatrix(
        [.213 + .787 * cosine - .213 * sine, .715 - .715 * cosine - .715 * sine, .072 - .072 * cosine + .928 * sine, 0, 0],
        [.213 - .213 * cosine + .143 * sine, .715 + .285 * cosine + .140 * sine, .072 - .072 * cosine - .283 * sine, 0, 0],
        [.213 - .213 * cosine - .787 * sine, .715 - .715 * cosine + .715 * sine, .072 + .928 * cosine + .072 * sine, 0, 0],
    );
};

function layerImageFilter(skia: typeof Skia, scope: Scope, filter: StaticPreviewFilter, sigma: number) {
    let colour: ReturnType<typeof Skia.ColorFilter.MakeMatrix> | null = null;
    const append = (matrix: number[]) => {
        const next = scope.own(skia.ColorFilter.MakeMatrix(matrix));
        colour = colour ? scope.own(skia.ColorFilter.MakeCompose(next, colour)) : next;
    };
    if (filter.brightness !== 1) append(brightnessMatrix(filter.brightness));
    if (filter.contrast !== 1) append(contrastMatrix(filter.contrast));
    if (filter.saturate !== 1) append(saturationMatrix(filter.saturate));
    if (filter.hue !== 0) append(hueMatrix(filter.hue));
    let imageFilter = colour ? scope.own(skia.ImageFilter.MakeColorFilter(colour, null)) : null;
    if (sigma > 0) imageFilter = scope.own(skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Decal, imageFilter));
    return imageFilter;
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
    size: { width: number; height: number }, layerCanvas: SkCanvas, outset: number) {
    const mask = layer.mask;
    if (!mask) return;
    withScope(maskScope => {
        const surface = maskScope.own(skia.Surface.Make(plan.width + outset * 2, plan.height + outset * 2)
            ?? (() => { throw Error('editor-static-surface'); })());
        const canvas = surface.getCanvas(), paint = maskScope.own(skia.Paint());
        canvas.clear(skia.Color(mask.inverted ? '#ffffff' : '#00000000'));
        paint.setAntiAlias(true); paint.setColor(skia.Color('#ffffff'));
        if (mask.inverted) paint.setBlendMode(BlendMode.Clear);
        const sigma = mask.feather * Math.min(size.width, size.height);
        if (sigma > 0) paint.setMaskFilter(maskScope.own(skia.MaskFilter.MakeBlur(BlurStyle.Normal, sigma, true)));
        canvas.save();
        try {
            canvas.translate(outset, outset);
            withLayerTransform(canvas, plan, layer, size, () => {
                canvas.translate(-size.width / 2 + mask.x * size.width, -size.height / 2 + mask.y * size.height);
                canvas.rotate(mask.rotation, 0, 0);
                const path = maskScope.own(maskPath(skia, mask, { width: size.width * mask.width, height: size.height * mask.height }));
                canvas.drawPath(path, paint);
            });
        } finally { canvas.restore(); }
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
        const geometry = filterGeometry(plan, layer.filter);
        const surface = scope.own(skia.Surface.Make(geometry.width, geometry.height) ?? (() => { throw Error('editor-static-surface'); })());
        const canvas = surface.getCanvas(), paint = scope.own(skia.Paint());
        canvas.clear(skia.Color('#00000000')); paint.setAntiAlias(true);
        canvas.save();
        try {
            canvas.translate(geometry.outset, geometry.outset);
            withLayerTransform(canvas, plan, layer, size, () => canvas.drawImageRectOptions(image, src,
                { x: -size.width / 2, y: -size.height / 2, ...size }, FilterMode.Linear, MipmapMode.None, paint));
        } finally { canvas.restore(); }
        applyMask(skia, plan, layer, size, canvas, geometry.outset);
        surface.flush();
        const snapshot = scope.own(surface.makeImageSnapshot()), imageFilter = layerImageFilter(skia, scope, layer.filter, geometry.sigma);
        const composite = scope.own(skia.Paint());
        composite.setAlphaf(layer.transform.opacity); composite.setBlendMode(blendModes[layer.blend]);
        if (imageFilter) composite.setImageFilter(imageFilter);
        output.drawImage(snapshot, -geometry.outset, -geometry.outset, composite);
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
