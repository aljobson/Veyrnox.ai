import { AlphaType, ColorType, type SkImage } from '@shopify/react-native-skia';
import { bindStaticPreviewPlan, renderStaticPreviewImage, renderStaticPreviewRgba, SKIA_STATIC_PREVIEW_CAPABILITIES, type StaticPreviewLayer, type StaticPreviewPlan } from '../src/lib/editorRender';
import { editorPreviewPlan } from '../src/lib/editorPreviewPlan';
import { emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';

jest.mock('@shopify/react-native-skia', () => require('@shopify/react-native-skia/lib/commonjs/skia/types'));

const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit');
let Skia: any;
let ImageFormat: any;

beforeAll(async () => {
    const kit = await CanvasKitInit({});
    ({ Skia, ImageFormat } = require('@shopify/react-native-skia/lib/commonjs/mock').Mock(kit));
});

function image(width: number, height: number, draw: (canvas: any, paint: any) => void): SkImage {
    const surface = Skia.Surface.Make(width, height), paint = Skia.Paint();
    try {
        draw(surface.getCanvas(), paint); surface.flush();
        const snapshot = surface.makeImageSnapshot(), data = Skia.Data.fromBytes(snapshot.encodeToBytes(ImageFormat.PNG));
        try {
            const decoded = Skia.Image.MakeImageFromEncoded(data);
            if (!decoded) throw Error('fixture-image');
            return decoded;
        } finally { data.dispose(); snapshot.dispose(); }
    } finally { paint.dispose(); surface.dispose(); }
}

const solid = (color: string, width = 8, height = 8) => image(width, height, (canvas, paint) => {
    paint.setColor(Skia.Color(color)); canvas.drawRect({ x: 0, y: 0, width, height }, paint);
});

const transform = { x: .5, y: .5, scale: 1, rotation: 0, opacity: 1, flipX: false, flipY: false } as const;
const filter = { brightness: 1, contrast: 1, saturate: 1, hue: 0, blur: 0 } as const;
function layer(id: string, source: SkImage, patch: Partial<StaticPreviewLayer> = {}): StaticPreviewLayer {
    return {
        id, trackOrder: 0, clipOrder: 0, image: source,
        crop: { x: 0, y: 0, width: 1, height: 1 }, fit: 'contain', transform,
        filter, blend: 'source-over', background: { type: 'none' }, ...patch,
    };
}
const plan = (layers: StaticPreviewLayer[], patch: Partial<StaticPreviewPlan> = {}): StaticPreviewPlan => {
    const width = patch.width ?? 8, height = patch.height ?? 8;
    return {
        width, height,
        referenceWidth: patch.referenceWidth ?? (width >= 2 ? width : 8),
        referenceHeight: patch.referenceHeight ?? (height >= 2 ? height : 8),
        background: '#00ff00', layers, ...patch,
    };
};
function pixel(result: ReturnType<typeof renderStaticPreviewRgba>, x: number, y: number) {
    if (!result.ok) throw Error(result.code);
    return Array.from(result.rgba.slice((y * result.width + x) * 4, (y * result.width + x + 1) * 4));
}
const close = (actual: number[], expected: number[], tolerance = 2) => expected.forEach((value, index) => expect(Math.abs(actual[index] - value)).toBeLessThanOrEqual(tolerance));

function trackedSurfaceSkia(throwOnFirstDispose = false) {
    const make = Skia.Surface.Make.bind(Skia.Surface);
    let live = 0, peak = 0, disposed = 0, threw = false;
    const opened = () => { live++; peak = Math.max(peak, live); };
    const closed = () => { live--; disposed++; };
    const custom = { ...Skia, Surface: { ...Skia.Surface, Make: (...args: any[]) => {
        const surface = make(...args);
        if (!surface) return surface;
        opened();
        const disposeSurface = surface.dispose.bind(surface), snapshot = surface.makeImageSnapshot.bind(surface);
        surface.dispose = () => {
            try { disposeSurface(); } finally { closed(); }
            if (throwOnFirstDispose && !threw) { threw = true; throw Error('dispose-probe'); }
        };
        surface.makeImageSnapshot = () => {
            const value = snapshot(); opened();
            const disposeImage = value.dispose.bind(value);
            value.dispose = () => { try { disposeImage(); } finally { closed(); } };
            return value;
        };
        return surface;
    } } };
    return { custom, state: () => ({ live, peak, disposed }) };
}

test('crop and contain/cover use the bounded output while preserving the supplied images', () => {
    const striped = image(4, 2, (canvas, paint) => {
        paint.setColor(Skia.Color('#ff0000')); canvas.drawRect({ x: 0, y: 0, width: 2, height: 2 }, paint);
        paint.setColor(Skia.Color('#0000ff')); canvas.drawRect({ x: 2, y: 0, width: 2, height: 2 }, paint);
    });
    const dispose = jest.spyOn(striped, 'dispose');
    try {
        const contained = renderStaticPreviewRgba(Skia, plan([layer('contain', striped)]));
        expect(pixel(contained, 0, 0)).toEqual([0, 255, 0, 255]);
        close(pixel(contained, 1, 4), [255, 0, 0, 255]); close(pixel(contained, 6, 4), [0, 0, 255, 255]);
        const cropped = renderStaticPreviewRgba(Skia, plan([layer('crop', striped, { crop: { x: .5, y: 0, width: .5, height: 1 } })]));
        close(pixel(cropped, 1, 1), [0, 0, 255, 255]); close(pixel(cropped, 6, 6), [0, 0, 255, 255]);
        const covered = renderStaticPreviewRgba(Skia, plan([layer('cover', striped, { fit: 'cover' })]));
        close(pixel(covered, 1, 4), [255, 0, 0, 255]); close(pixel(covered, 6, 4), [0, 0, 255, 255]);
        expect(dispose).not.toHaveBeenCalled();
    } finally { dispose.mockRestore(); striped.dispose(); }
});

test.each([
    ['source-over', [192, 128, 64, 255]],
    ['multiply', [48, 64, 48, 255]],
    ['screen', [208, 192, 208, 255]],
    ['overlay', [96, 129, 160, 255]],
    ['darken', [64, 128, 64, 255]],
    ['lighten', [192, 128, 192, 255]],
    ['difference', [128, 0, 128, 255]],
] as const)('supports the canonical %s blend', (blend, expected) => {
    const below = solid('#4080c0'), above = solid('#c08040');
    try {
        const result = renderStaticPreviewRgba(Skia, plan([
            layer('above-first-in-input', above, { trackOrder: 2, blend }),
            layer('below-second-in-input', below, { trackOrder: 1 }),
        ]));
        close(pixel(result, 4, 4), [...expected], 3);
    } finally { below.dispose(); above.dispose(); }
});

test('evaluated transform, opacity and stable track order affect the destination draw once', () => {
    const red = solid('#ff0000'), blue = solid('#0000ff');
    try {
        const result = renderStaticPreviewRgba(Skia, plan([
            layer('upper', blue, { trackOrder: 2, transform: { ...transform, opacity: .5 } }),
            layer('lower', red, { trackOrder: 1 }),
        ]));
        close(pixel(result, 4, 4), [127, 0, 128, 255], 2);
        const moved = renderStaticPreviewRgba(Skia, plan([layer('moved', blue, {
            transform: { ...transform, x: .25, y: .25, scale: .5 },
        })]));
        close(pixel(moved, 1, 1), [0, 0, 255, 255]); expect(pixel(moved, 7, 7)).toEqual([0, 255, 0, 255]);
    } finally { red.dispose(); blue.dispose(); }
});

test('basic colour filters follow the canonical CSS brightness, contrast, saturation and hue order', () => {
    const source = solid('#406080');
    try {
        const result = renderStaticPreviewRgba(Skia, plan([layer('filtered', source, {
            filter: { brightness: 1.2, contrast: .8, saturate: .6, hue: 30, blur: 0 },
        })]));
        // Filter Effects matrix fixture for #406080 in the declared canonical order.
        close(pixel(result, 4, 4), [110, 112, 139, 255], 3);
    } finally { source.dispose(); }
});

test('basic colour filters clamp between CSS filter functions', () => {
    const source = solid('#c80000');
    try {
        const result = renderStaticPreviewRgba(Skia, plan([layer('clamped', source, {
            filter: { ...filter, brightness: 3, contrast: .5 },
        })]));
        // brightness(3) first clamps red to 255; contrast(.5) then pivots every channel at 0.5.
        close(pixel(result, 4, 4), [191, 64, 64, 255], 2);
    } finally { source.dispose(); }
});

test('basic blur uses raw output pixels and transparent decal edges', () => {
    const source = image(64, 64, (canvas, paint) => {
        canvas.clear(Skia.Color('#00000000'));
        paint.setColor(Skia.Color('#ffffff')); canvas.drawRect({ x: 30, y: 30, width: 4, height: 4 }, paint);
    });
    try {
        const result = renderStaticPreviewRgba(Skia, plan([layer('blurred', source, {
            filter: { ...filter, blur: 3 },
        })], { width: 64, height: 64, background: '#000000' }));
        if (!result.ok) throw Error(result.code);
        const center = pixel(result, 32, 32)[0], spread = pixel(result, 26, 32)[0];
        expect(center).toBeGreaterThan(spread);
        expect(spread).toBeGreaterThan(0);
        const redEnergy = result.rgba.reduce((total, channel, index) => index % 4 === 0 ? total + channel : total, 0);
        // CanvasKit's raw sigma-3 reference spreads this centered impulse to 436 red units.
        // A mistaken 720p height scale leaves almost all 4,080 source units concentrated.
        expect(redEnergy).toBeGreaterThan(400);
        expect(redEnergy).toBeLessThan(500);
        expect(pixel(result, 0, 0)).toEqual([0, 0, 0, 255]);
    } finally { source.dispose(); }
});

test('basic blur keeps the same fractional footprint at two output sizes', () => {
    const makeBlur = Skia.ImageFilter.MakeBlur.bind(Skia.ImageFilter), sigmas: number[] = [];
    const custom = { ...Skia, ImageFilter: { ...Skia.ImageFilter,
        MakeBlur: (sigmaX: number, sigmaY: number, mode: any, input: any) => {
            expect(sigmaY).toBe(sigmaX); sigmas.push(sigmaX); return makeBlur(sigmaX, sigmaY, mode, input);
        },
    } };
    const render = (size: number) => {
        const source = image(size, size, (canvas, paint) => {
            canvas.clear(Skia.Color('#00000000')); paint.setColor(Skia.Color('#ffffff'));
            canvas.drawRect({ x: size * .45, y: size * .45, width: size * .1, height: size * .1 }, paint);
        });
        try {
            return renderStaticPreviewRgba(custom, plan([layer(`scaled-${size}`, source, {
                filter: { ...filter, blur: 30 },
            })], { width: size, height: size, referenceWidth: 720, referenceHeight: 720, background: '#000000' }));
        } finally { source.dispose(); }
    };
    const small = render(72), large = render(144);
    expect(small.ok).toBe(true); expect(large.ok).toBe(true);
    expect(sigmas).toEqual([3, 6]);
    expect(sigmas[0] / 72).toBeCloseTo(sigmas[1] / 144, 10);
});

test('the 1280x720 canonical reference uses sigma 30 and a three-sigma extended layer surface', () => {
    const source = solid('#ffffff', 16, 9), make = Skia.Surface.Make.bind(Skia.Surface);
    const makeBlur = Skia.ImageFilter.MakeBlur.bind(Skia.ImageFilter), surfaces: [number, number][] = [], sigmas: number[] = [];
    const custom = {
        ...Skia,
        Surface: { ...Skia.Surface, Make: (width: number, height: number) => { surfaces.push([width, height]); return make(width, height); } },
        ImageFilter: { ...Skia.ImageFilter, MakeBlur: (sigmaX: number, sigmaY: number, mode: any, input: any) => {
            sigmas.push(sigmaX, sigmaY); return makeBlur(sigmaX, sigmaY, mode, input);
        } },
    };
    try {
        const result = renderStaticPreviewImage(custom, plan([layer('reference', source, {
            fit: 'cover', filter: { ...filter, blur: 30 },
        })], { width: 1280, height: 720, referenceWidth: 1280, referenceHeight: 720, background: '#000000' }));
        expect(result.ok).toBe(true);
        if (result.ok) result.image.dispose();
        expect(sigmas).toEqual([30, 30]);
        expect(surfaces).toContainEqual([1460, 900]);
    } finally { source.dispose(); }
});

test.each([
    ['portrait', 360, 640, 405, 720, 9, 8],
    ['square', 640, 640, 720, 720, 9, 8],
    ['ultrawide', 1280, 240, 3840, 720, 30, 10],
] as const)('%s output uses one aspect-preserving canonical filter scale', (_name, width, height, referenceWidth, referenceHeight, blur, expectedSigma) => {
    const source = solid('#ffffff', 16, 16), makeBlur = Skia.ImageFilter.MakeBlur.bind(Skia.ImageFilter), sigmas: number[] = [];
    const custom = { ...Skia, ImageFilter: { ...Skia.ImageFilter,
        MakeBlur: (sigmaX: number, sigmaY: number, mode: any, input: any) => {
            sigmas.push(sigmaX, sigmaY); return makeBlur(sigmaX, sigmaY, mode, input);
        },
    } };
    try {
        const result = renderStaticPreviewImage(custom, plan([layer(`aspect-${_name}`, source, {
            fit: 'cover', filter: { ...filter, blur },
        })], { width, height, referenceWidth, referenceHeight, background: '#000000' }));
        expect(result.ok).toBe(true);
        if (result.ok) result.image.dispose();
        expect(sigmas).toEqual([expectedSigma, expectedSigma]);
    } finally { source.dispose(); }
});

test.each([
    ['cover', 128, 64, { fit: 'cover' as const }],
    ['scale', 64, 64, { transform: { ...transform, scale: 2 } }],
])('three-sigma overscan prevents a dark %s halo at the canonical frame edge', (_name, width, height, patch) => {
    const source = solid('#ffffff', width, height);
    try {
        const result = renderStaticPreviewRgba(Skia, plan([layer('edge', source, {
            ...patch, filter: { ...filter, blur: 4 },
        })], { width: 64, height: 64, referenceWidth: 64, referenceHeight: 64, background: '#000000' }));
        expect(pixel(result, 0, 32)[0]).toBeGreaterThan(240);
        expect(pixel(result, 63, 32)[0]).toBeGreaterThan(240);
    } finally { source.dispose(); }
});

test('mask overscan preserves off-frame masked pixels before basic blur', () => {
    const source = solid('#ffffff', 128, 64);
    try {
        const edge = renderStaticPreviewRgba(Skia, plan([layer('masked-edge', source, {
            fit: 'cover', filter: { ...filter, blur: 4 },
            mask: { shape: 'circle', x: .25, y: .5, width: .25, height: .5, rotation: 0, feather: 0, inverted: false },
        })], { width: 64, height: 64, referenceWidth: 64, referenceHeight: 64, background: '#000000' }));
        const centered = renderStaticPreviewRgba(Skia, plan([layer('masked-center', source, {
            fit: 'cover', filter: { ...filter, blur: 4 },
            mask: { shape: 'circle', x: .5, y: .5, width: .25, height: .5, rotation: 0, feather: 0, inverted: false },
        })], { width: 64, height: 64, referenceWidth: 64, referenceHeight: 64, background: '#000000' }));
        close(pixel(edge, 0, 32), pixel(centered, 32, 32), 2);
        expect(pixel(edge, 24, 32)).toEqual([0, 0, 0, 255]);
    } finally { source.dispose(); }
});

test('a basic blur expands the already masked foreground while leaving the clip background unfiltered', () => {
    const source = solid('#ffffff', 64, 64), mask = {
        shape: 'circle' as const, x: .5, y: .5, width: .25, height: .25, rotation: 0, feather: 0, inverted: false,
    };
    try {
        const sharp = renderStaticPreviewRgba(Skia, plan([layer('sharp', source, { mask })], {
            width: 64, height: 64, background: '#000000',
        }));
        const blurred = renderStaticPreviewRgba(Skia, plan([layer('blurred', source, {
            mask, filter: { ...filter, blur: 4 }, background: { type: 'solid', color: '#0000ff' },
        })], { width: 64, height: 64, background: '#000000' }));
        expect(pixel(sharp, 44, 32)).toEqual([0, 0, 0, 255]);
        expect(pixel(blurred, 44, 32)[0]).toBeGreaterThan(0);
        expect(pixel(blurred, 0, 0)).toEqual([0, 0, 255, 255]);
    } finally { source.dispose(); }
});

test('basic filters do not change a clip background', () => {
    const source = solid('#ff0000', 8, 2);
    try {
        const result = renderStaticPreviewRgba(Skia, plan([layer('foreground', source, {
            filter: { ...filter, brightness: 0 }, background: { type: 'solid', color: '#0000ff' },
        })]));
        expect(pixel(result, 4, 4)).toEqual([0, 0, 0, 255]);
        expect(pixel(result, 0, 0)).toEqual([0, 0, 255, 255]);
    } finally { source.dispose(); }
});

test.each(['circle', 'rounded', 'horizontal', 'vertical'] as const)('%s masks render and dispose their Skia path', shape => {
    const source = solid('#ff0000'), original = Skia.Path[shape === 'circle' ? 'Oval' : shape === 'rounded' ? 'RRect' : 'Rect'].bind(Skia.Path);
    let disposed = 0;
    const pathFactory = (...args: any[]) => {
        const value = original(...args), dispose = value.dispose.bind(value);
        value.dispose = () => { disposed++; dispose(); }; return value;
    };
    const custom = { ...Skia, Path: { ...Skia.Path, [shape === 'circle' ? 'Oval' : shape === 'rounded' ? 'RRect' : 'Rect']: pathFactory } };
    try {
        const result = renderStaticPreviewRgba(custom, plan([layer('masked', source, {
            mask: { shape, x: .5, y: .5, width: .5, height: .5, rotation: 0, feather: 0, inverted: false },
        })]));
        close(pixel(result, 4, 4), [255, 0, 0, 255]); expect(pixel(result, 0, 0)).toEqual([0, 255, 0, 255]);
        expect(disposed).toBe(1);
    } finally { source.dispose(); }
});

test('feather and inversion preserve a soft, reversed alpha boundary', () => {
    const source = solid('#ff0000', 32, 32);
    const base = { shape: 'circle' as const, x: .5, y: .5, width: .5, height: .5, rotation: 0, feather: .12, inverted: false };
    try {
        const soft = renderStaticPreviewRgba(Skia, plan([layer('soft', source, { mask: base })], { width: 32, height: 32 }));
        const center = pixel(soft, 16, 16); expect(center[0]).toBeGreaterThan(220); expect(center[1]).toBeLessThan(35);
        expect(pixel(soft, 0, 0)).toEqual([0, 255, 0, 255]);
        const edge = pixel(soft, 24, 16); expect(edge[0]).toBeGreaterThan(0); expect(edge[1]).toBeGreaterThan(0);
        const inverted = renderStaticPreviewRgba(Skia, plan([layer('inverse', source, { mask: { ...base, inverted: true, feather: 0 } })], { width: 32, height: 32 }));
        expect(pixel(inverted, 16, 16)).toEqual([0, 255, 0, 255]); close(pixel(inverted, 0, 0), [255, 0, 0, 255]);
    } finally { source.dispose(); }
});

test('solid, image and blurred clip backgrounds paint below contained foregrounds', () => {
    const foreground = solid('#ff0000', 8, 2), backdrop = solid('#0000ff', 2, 8);
    try {
        const solidResult = renderStaticPreviewRgba(Skia, plan([layer('solid', foreground, { background: { type: 'solid', color: '#ffff00' } })]));
        close(pixel(solidResult, 0, 0), [255, 255, 0, 255]);
        const imageResult = renderStaticPreviewRgba(Skia, plan([layer('image', foreground, { background: { type: 'image', color: '#000000', image: backdrop } })]));
        close(pixel(imageResult, 0, 0), [0, 0, 255, 255]);
        const blurResult = renderStaticPreviewRgba(Skia, plan([layer('blur', foreground, { background: { type: 'blur', color: '#000000', blur: 8 } })]));
        const corner = pixel(blurResult, 0, 0); expect(corner[0]).toBeGreaterThan(corner[1]); expect(corner[0]).toBeGreaterThan(corner[2]);
    } finally { foreground.dispose(); backdrop.dispose(); }
});

test('blurred clip backgrounds use the canonical three-sigma overscan geometry', () => {
    const foreground = solid('#ff0000', 8, 2), make = Skia.Surface.Make.bind(Skia.Surface);
    const draws: { x: number; y: number; width: number; height: number }[] = [];
    const custom = { ...Skia, Surface: { ...Skia.Surface, Make: (...args: any[]) => {
        const surface = make(...args), canvas = surface?.getCanvas();
        if (!surface || !canvas) return surface;
        const canvasProxy = new Proxy(canvas, { get(target, property) {
            const value = Reflect.get(target, property);
            if (property === 'drawImageRectOptions') return (...drawArgs: any[]) => { draws.push(drawArgs[2]); return value.apply(target, drawArgs); };
            return typeof value === 'function' ? value.bind(target) : value;
        } });
        return new Proxy(surface, { get(target, property) {
            if (property === 'getCanvas') return () => canvasProxy;
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
        } });
    } } };
    try {
        const result = renderStaticPreviewRgba(custom, plan([layer('blur', foreground, {
            background: { type: 'blur', color: '#000000', blur: 24 },
        })], { width: 32, height: 32 }));
        expect(result.ok).toBe(true);
        const pad = 24 * 32 / 720 * 3, scale = (32 + pad * 2) / 2;
        expect(draws[0]).toEqual(expect.objectContaining({
            x: expect.closeTo((32 - 8 * scale) / 2, 5), y: expect.closeTo(-pad, 5),
            width: expect.closeTo(8 * scale, 5), height: expect.closeTo(2 * scale, 5),
        }));
        expect(draws[0].width).toBeGreaterThan(128); // Ordinary, non-overscanned cover width.
    } finally { foreground.dispose(); }
});

test('canonical planning reports unsupported features instead of silently dropping them', () => {
    const source = solid('#ffffff');
    try {
        const timeline: Timeline = {
            ...emptyTimeline(),
            media: { image: { id: 'image', kind: 'image', frames: 90 }, video: { id: 'video', kind: 'video', frames: 90 } },
            video: [
                { id: 'v1', mediaId: 'image', start: 0, in: 0, len: 90, trackId: 'video-0', volume: 1, transition: 0,
                    effect: { type: 'tiles', intensity: .5 } },
                { id: 'v2', mediaId: 'video', start: 0, in: 0, len: 90, trackId: 'video-0', volume: 1, transition: 0 },
            ],
            text: [{ id: 't1', text: 'Title', start: 0, len: 90, trackId: 'text-0', x: .5, y: .5, size: 6 }],
        };
        const canonical = editorPreviewPlan(timeline, 10, SKIA_STATIC_PREVIEW_CAPABILITIES);
        const built = bindStaticPreviewPlan(canonical, 16, 9, { image: source });
        expect(renderStaticPreviewRgba(Skia, built)).toEqual({ ok: false, code: 'unsupported', features: ['effect', 'missing-source-image', 'text', 'video'] });
    } finally { source.dispose(); }
});

test('canonical evaluated basic filters bind as an exact Skia capability', () => {
    const source = solid('#ffffff'), value = emptyTimeline();
    value.media.image = { id: 'image', kind: 'image', frames: 90, width: 640, height: 360, hasAudio: false };
    value.video = [{ id: 'v1', mediaId: 'image', start: 0, in: 0, len: 90, trackId: 'video-0', volume: 1, transition: 0,
        filter: { brightness: 1.2, contrast: .8, saturate: .6, hue: 30, blur: 4 } }];
    try {
        const canonical = editorPreviewPlan(value, 10, SKIA_STATIC_PREVIEW_CAPABILITIES);
        expect(canonical.capabilities.unsupported).not.toContainEqual(expect.objectContaining({ capability: 'basic-filter' }));
        const bound = bindStaticPreviewPlan(canonical, 640, 360, { image: source });
        expect(bound.referenceWidth).toBe(1280);
        expect(bound.referenceHeight).toBe(720);
        expect(bound.layers[0].filter).toEqual({ brightness: 1.2, contrast: .8, saturate: .6, hue: 30, blur: 4 });
        expect(renderStaticPreviewRgba(Skia, bound).ok).toBe(true);
    } finally { source.dispose(); }
});

test('a non-full canonical reveal is refused before rendering', () => {
    const source = solid('#ffffff');
    try {
        const timeline: Timeline = {
            ...emptyTimeline(), media: { image: { id: 'image', kind: 'image', frames: 90 } },
            video: [{ id: 'v1', mediaId: 'image', start: 0, in: 0, len: 90, trackId: 'video-0', volume: 1, transition: 0,
                animation: { in: 'wipe-left', out: 'none', duration: 30 } }],
        };
        const canonical = editorPreviewPlan(timeline, 5, SKIA_STATIC_PREVIEW_CAPABILITIES);
        const bound = bindStaticPreviewPlan(canonical, 16, 9, { image: source });
        expect(bound.layers[0].unsupported).toContain('animation-reveal');
        expect(renderStaticPreviewRgba(Skia, bound)).toEqual({ ok: false, code: 'unsupported', features: ['animation-reveal'] });
    } finally { source.dispose(); }
});

test('canonical orphan requirements remain explicit when there is no drawable layer', () => {
    const timeline: Timeline = {
        ...emptyTimeline(),
        video: [{ id: 'orphan', mediaId: 'missing', start: 0, in: 0, len: 90, trackId: 'video-0', volume: 1, transition: 0 }],
    };
    const canonical = editorPreviewPlan(timeline, 5, SKIA_STATIC_PREVIEW_CAPABILITIES);
    const bound = bindStaticPreviewPlan(canonical, 16, 9, {});
    expect(bound.layers).toEqual([]);
    expect(renderStaticPreviewRgba(Skia, bound)).toEqual({ ok: false, code: 'unsupported', features: ['missing-source-image'] });
});

test('canonical transform, crop and mask bounds refuse native allocation', () => {
    const source = solid('#ffffff'), make = jest.fn();
    const noAllocation = { ...Skia, Surface: { ...Skia.Surface, Make: make } };
    const baseMask = { shape: 'circle' as const, x: .5, y: .5, width: 1, height: 1, rotation: 0, feather: 0, inverted: false };
    const cases: [string, Partial<StaticPreviewLayer>, string][] = [
        ['transform x', { transform: { ...transform, x: -2.001 } }, 'invalid-transform'],
        ['transform y', { transform: { ...transform, y: 3.001 } }, 'invalid-transform'],
        ['transform scale low', { transform: { ...transform, scale: .049 } }, 'invalid-transform'],
        ['transform scale high', { transform: { ...transform, scale: 8.001 } }, 'invalid-transform'],
        ['transform rotation', { transform: { ...transform, rotation: 360.001 } }, 'invalid-transform'],
        ['transform opacity', { transform: { ...transform, opacity: 1.001 } }, 'invalid-transform'],
        ['filter brightness', { filter: { ...filter, brightness: 3.001 } }, 'invalid-filter'],
        ['filter contrast', { filter: { ...filter, contrast: -.001 } }, 'invalid-filter'],
        ['filter saturate', { filter: { ...filter, saturate: 3.001 } }, 'invalid-filter'],
        ['filter hue', { filter: { ...filter, hue: 180.001 } }, 'invalid-filter'],
        ['filter blur', { filter: { ...filter, blur: 30.001 } }, 'invalid-filter'],
        ['crop width', { crop: { x: 0, y: 0, width: .049, height: 1 } }, 'invalid-crop'],
        ['crop height', { crop: { x: 0, y: 0, width: 1, height: .049 } }, 'invalid-crop'],
        ['crop boundary', { crop: { x: .1, y: 0, width: .91, height: 1 } }, 'invalid-crop'],
        ['mask x low', { mask: { ...baseMask, x: -1.001 } }, 'invalid-mask'],
        ['mask x high', { mask: { ...baseMask, x: 2.001 } }, 'invalid-mask'],
        ['mask y low', { mask: { ...baseMask, y: -1.001 } }, 'invalid-mask'],
        ['mask y high', { mask: { ...baseMask, y: 2.001 } }, 'invalid-mask'],
        ['mask width low', { mask: { ...baseMask, width: .049 } }, 'invalid-mask'],
        ['mask width high', { mask: { ...baseMask, width: 2.001 } }, 'invalid-mask'],
        ['mask height low', { mask: { ...baseMask, height: .049 } }, 'invalid-mask'],
        ['mask height high', { mask: { ...baseMask, height: 2.001 } }, 'invalid-mask'],
        ['mask rotation', { mask: { ...baseMask, rotation: -360.001 } }, 'invalid-mask'],
        ['mask feather', { mask: { ...baseMask, feather: .251 } }, 'invalid-mask'],
    ];
    try {
        for (const [name, patch, issue] of cases) {
            const result = renderStaticPreviewRgba(noAllocation, plan([layer(name, source, patch)]));
            expect(result).toEqual({ ok: false, code: 'invalid-plan', issues: [issue] });
        }
        expect(make).not.toHaveBeenCalled();
    } finally { source.dispose(); }
});

test('invalid reference and extended filter geometry fail before native allocation', () => {
    const source = solid('#ffffff'), make = jest.fn(), noAllocation = { ...Skia, Surface: { ...Skia.Surface, Make: make } };
    try {
        expect(renderStaticPreviewRgba(noAllocation, plan([layer('reference-width', source)], { referenceWidth: 0 }))).toEqual({
            ok: false, code: 'invalid-plan', issues: ['invalid-reference-width'],
        });
        expect(renderStaticPreviewRgba(noAllocation, plan([layer('reference', source)], { referenceHeight: 0 }))).toEqual({
            ok: false, code: 'invalid-plan', issues: ['invalid-reference-height'],
        });
        expect(renderStaticPreviewRgba(noAllocation, plan([layer('aspect', source)], {
            width: 100, height: 100, referenceWidth: 1280, referenceHeight: 720,
        }))).toEqual({ ok: false, code: 'invalid-plan', issues: ['invalid-reference-aspect'] });
        expect(renderStaticPreviewRgba(noAllocation, plan([layer('oversized', source, {
            filter: { ...filter, blur: 30 },
        })], { width: 1280, height: 640, referenceWidth: 4, referenceHeight: 2 }))).toEqual({
            ok: false, code: 'invalid-plan', issues: ['invalid-filter-surface'],
        });
        expect(make).not.toHaveBeenCalled();
    } finally { source.dispose(); }
});

test('one-pixel integer rounding in a matching reference aspect is accepted', () => {
    const source = solid('#ffffff');
    try {
        const result = renderStaticPreviewImage(Skia, plan([layer('rounded-aspect', source)], {
            width: 100, height: 56, referenceWidth: 1280, referenceHeight: 720,
        }));
        expect(result.ok).toBe(true);
        if (result.ok) result.image.dispose();
    } finally { source.dispose(); }
});

test('layer and mask surfaces dispose before the next layer and caller images stay owned by the caller', () => {
    const source = solid('#ffffff', 32, 32), disposeSource = jest.spyOn(source, 'dispose'), tracked = trackedSurfaceSkia();
    const mask = { shape: 'circle' as const, x: .5, y: .5, width: .8, height: .8, rotation: 0, feather: .1, inverted: false };
    try {
        const result = renderStaticPreviewRgba(tracked.custom, plan(Array.from({ length: 12 }, (_, index) => layer(`layer-${index}`, source, {
            mask, filter: { ...filter, blur: 4 },
        })), {
            width: 32, height: 32,
        }));
        expect(result.ok).toBe(true);
        expect(tracked.state()).toMatchObject({ live: 0, peak: 4 });
        expect(tracked.state().disposed).toBeGreaterThan(24);
        expect(disposeSource).not.toHaveBeenCalled();
    } finally { disposeSource.mockRestore(); source.dispose(); }
});

test('basic filter resources dispose once per layer while neutral filters allocate none', () => {
    const source = solid('#406080', 32, 32), disposeSource = jest.spyOn(source, 'dispose');
    const makeMatrix = Skia.ColorFilter.MakeMatrix.bind(Skia.ColorFilter);
    const makeCompose = Skia.ColorFilter.MakeCompose.bind(Skia.ColorFilter);
    const makeColourImage = Skia.ImageFilter.MakeColorFilter.bind(Skia.ImageFilter);
    const makeBlur = Skia.ImageFilter.MakeBlur.bind(Skia.ImageFilter);
    let created = 0, disposed = 0, live = 0;
    const tracked = <T extends { dispose(): void }>(value: T): T => {
        created++; live++;
        const close = value.dispose.bind(value); let closed = false;
        value.dispose = () => {
            expect(closed).toBe(false); closed = true; disposed++; live--; close();
        };
        return value;
    };
    const custom = {
        ...Skia,
        ColorFilter: {
            ...Skia.ColorFilter,
            MakeMatrix: (matrix: any) => tracked(makeMatrix(matrix)),
            MakeCompose: (outer: any, inner: any) => tracked(makeCompose(outer, inner)),
        },
        ImageFilter: {
            ...Skia.ImageFilter,
            MakeColorFilter: (colour: any, input: any) => tracked(makeColourImage(colour, input)),
            MakeBlur: (sigmaX: number, sigmaY: number, mode: any, input: any) => tracked(makeBlur(sigmaX, sigmaY, mode, input)),
        },
    };
    try {
        expect(renderStaticPreviewRgba(custom, plan([layer('filtered', source, {
            filter: { brightness: 1.2, contrast: .8, saturate: .6, hue: 30, blur: 4 },
        })], { width: 32, height: 32 })).ok).toBe(true);
        expect(created).toBeGreaterThanOrEqual(9);
        expect(disposed).toBe(created); expect(live).toBe(0);
        const afterFiltered = created;
        expect(renderStaticPreviewRgba(custom, plan([layer('neutral', source)], { width: 32, height: 32 })).ok).toBe(true);
        expect(created).toBe(afterFiltered);
        expect(disposeSource).not.toHaveBeenCalled();
    } finally { disposeSource.mockRestore(); source.dispose(); }
});

test('image rendering transfers only the final snapshot to the caller', () => {
    const source = solid('#ffffff', 32, 32), disposeSource = jest.spyOn(source, 'dispose'), tracked = trackedSurfaceSkia();
    try {
        const rendered = renderStaticPreviewImage(tracked.custom, plan([layer('source', source)], { width: 32, height: 32 }));
        expect(rendered.ok).toBe(true);
        if (!rendered.ok) throw Error(rendered.code);
        expect(tracked.state()).toMatchObject({ live: 1 });
        expect(disposeSource).not.toHaveBeenCalled();
        const disposeOutput = jest.spyOn(rendered.image, 'dispose');
        rendered.image.dispose();
        expect(disposeOutput).toHaveBeenCalledTimes(1);
        expect(tracked.state().live).toBe(0);
    } finally { disposeSource.mockRestore(); source.dispose(); }
});

test('RGBA rendering reads the caller-owned image path without changing pixels', () => {
    const source = image(8, 8, (canvas, paint) => {
        paint.setColor(Skia.Color('#ff0000')); canvas.drawRect({ x: 0, y: 0, width: 4, height: 8 }, paint);
        paint.setColor(Skia.Color('#0000ff')); canvas.drawRect({ x: 4, y: 0, width: 4, height: 8 }, paint);
    });
    try {
        const value = plan([layer('source', source)]), rendered = renderStaticPreviewImage(Skia, value);
        if (!rendered.ok) throw Error(rendered.code);
        let direct: Uint8Array;
        try {
            const pixels = rendered.image.readPixels(0, 0, {
                width: rendered.width, height: rendered.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul,
            });
            if (!pixels) throw Error('direct-readback');
            direct = new Uint8Array(pixels);
        } finally { rendered.image.dispose(); }
        const rgba = renderStaticPreviewRgba(Skia, value);
        if (!rgba.ok) throw Error(rgba.code);
        expect(Buffer.from(rgba.rgba).equals(Buffer.from(direct))).toBe(true);
    } finally { source.dispose(); }
});

test('image rendering validates invalid and unsupported plans before allocating', () => {
    const source = solid('#ffffff'), make = jest.fn(), noAllocation = { ...Skia, Surface: { ...Skia.Surface, Make: make } };
    try {
        expect(renderStaticPreviewImage(noAllocation, plan([], { width: 0 }))).toEqual({
            ok: false, code: 'invalid-plan', issues: ['invalid-output-size'],
        });
        expect(renderStaticPreviewImage(noAllocation, plan([layer('blocked', source, { unsupported: ['effect'] })]))).toEqual({
            ok: false, code: 'unsupported', features: ['effect'],
        });
        expect(make).not.toHaveBeenCalled();
    } finally { source.dispose(); }
});

test('an output-surface cleanup failure disposes the snapshot that never transferred', () => {
    const tracked = trackedSurfaceSkia(true);
    expect(() => renderStaticPreviewImage(tracked.custom, plan([]))).toThrow('dispose-probe');
    expect(tracked.state().live).toBe(0);
});

test('a throwing nested disposer does not prevent remaining native resources from closing', () => {
    const source = solid('#ffffff'), tracked = trackedSurfaceSkia(true);
    try {
        expect(() => renderStaticPreviewRgba(tracked.custom, plan([layer('masked', source, {
            mask: { shape: 'rounded', x: .5, y: .5, width: .8, height: .8, rotation: 0, feather: 0, inverted: false },
        })]))).toThrow('dispose-probe');
        expect(tracked.state().live).toBe(0);
    } finally { source.dispose(); }
});

test('invalid bounds fail before allocation and allocated resources are disposed on later failure', () => {
    expect(renderStaticPreviewRgba(Skia, plan([], { width: 1280, height: 1280 }))).toEqual({ ok: false, code: 'invalid-plan', issues: ['invalid-output-size'] });
    const source = solid('#ffffff'), outer = Skia.Surface.Make(8, 8), dispose = jest.spyOn(outer, 'dispose'); let calls = 0;
    const custom = { ...Skia, Surface: { ...Skia.Surface, Make: () => ++calls === 1 ? outer : null } };
    try {
        expect(() => renderStaticPreviewRgba(custom, plan([layer('source', source)]))).toThrow('editor-static-surface');
        expect(dispose).toHaveBeenCalledTimes(1);
    } finally { dispose.mockRestore(); source.dispose(); }
});
