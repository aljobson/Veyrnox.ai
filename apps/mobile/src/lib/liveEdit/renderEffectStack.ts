import { Skia, TileMode, FilterMode, MipmapMode, PaintStyle, ColorType, AlphaType, type SkImage, type SkShader } from '@shopify/react-native-skia';
import { lookMatrix } from '../instantLooks';
import { MAKEUP, rgb, hairRgb, hairTexture, type Stack } from './engine';
import { type FrameId, type Inference } from './protocol';
import { regionFor, type Region } from './geometry';
import { assembleStack } from './stack';
import { SKIN_SMOOTHING } from './smoothing';
import { runtimeEffect } from './runtimeEffects';
import { MATRIX, SMOOTH, MAKEUP_SHADER, HAIR_SHADER } from './shaders';
export type RenderSource = FrameId & { image: SkImage };
// The caller owns the returned picture. Recording retains native paint/shader references.
// No separate preview approximation or export implementation is permitted.
export function renderEffectStack(source: RenderSource, stack: Stack, inference: Inference | null) {
    const { image } = source, w = image.width(), h = image.height();
    const { stack: s, active, passes } = assembleStack(stack, source, inference);
    const resources: { dispose(): void }[] = [];
    const own = <T extends { dispose(): void }>(value: T): T => { resources.push(value); return value; };
    const shader = (img: SkImage, width = w, height = h) => {
        const matrix = own(Skia.Matrix()); matrix.scale(w / width, h / height);
        return own(img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None, matrix));
    };
    const program = (code: string, uniforms: number[], children: SkShader[]) => {
        const runtime = runtimeEffect(code);
        return own(runtime.makeShaderWithChildren(uniforms, children));
    };
    function mask(region: Region) {
        const scale = Math.min(1, 512 / Math.max(w, h)), mw = Math.max(8, Math.round(w * scale)), mh = Math.max(8, Math.round(h * scale));
        const surface = Skia.Surface.Make(mw, mh);
        if (!surface) throw Error('live-edit-surface-failed');
        own(surface); const canvas = surface.getCanvas(), paint = own(Skia.Paint());
        canvas.clear(Skia.Color('black')); paint.setAntiAlias(true);
        const point = (p: number[]) => ({ x: p[0] * mw, y: p[1] * mh });
        for (const shape of region.shapes) {
            const path = own(Skia.Path.Polygon(shape.vertices.map(point), true));
            paint.setColor(Skia.Color('yellow')); paint.setShader(null);
            if (shape.gradient) paint.setShader(own(Skia.Shader.MakeLinearGradient(point(shape.gradient[0]), point(shape.gradient[1]), [Skia.Color('red'), Skia.Color('yellow')], null, TileMode.Clamp)));
            if (shape.radial) paint.setShader(own(Skia.Shader.MakeRadialGradient(point(shape.radial.center), shape.radial.radius * mw, [Skia.Color('yellow'), Skia.Color('black')], null, TileMode.Clamp)));
            canvas.drawPath(path, paint);
        }
        paint.setShader(null); paint.setColor(Skia.Color('black'));
        for (const vertices of region.holes) {
            const path = own(Skia.Path.Polygon(vertices.map(point), true));
            paint.setStyle(PaintStyle.Fill); canvas.drawPath(path, paint);
            paint.setStyle(PaintStyle.Stroke); paint.setStrokeWidth(2); canvas.drawPath(path, paint);
        }
        surface.flush(); return shader(own(surface.makeImageSnapshot()), mw, mh);
    }
    try {
        if (!passes.length) {
            const recorder = own(Skia.PictureRecorder()), canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, w, h));
            canvas.drawImage(image, 0, 0);
            return recorder.finishRecordingAsPicture();
        }
        let current = shader(image);
        if (s.look !== 'original' && s.strength > 0) current = program(MATRIX, lookMatrix({ id: s.look, strength: s.strength }), [current]);
        const original = current;
        const radius = SKIN_SMOOTHING.sampleStepPixels;
        if (active) {
            if (s.smoothing > 0) current = program(SMOOTH, [s.smoothing, radius], [current, mask(regionFor('smoothing', active.landmarks, s, h / w))]);
            MAKEUP.forEach(({ id }, index) => {
                const value = s.makeup[id]; if (value.strength <= 0) return;
                current = program(MAKEUP_SHADER, [value.strength, index, ['matte', 'gloss', 'tint'].indexOf(value.finish ?? 'matte'), ...rgb(value.shade), ...rgb(value.shade2 ?? value.shade), radius], [current, original, mask(regionFor(id, active.landmarks, s, h / w))]);
            });
            const texture = s.hair.strength > 0 ? hairTexture(active.hair) : null;
            if (texture) {
                const data = own(Skia.Data.fromBytes(texture.data));
                const hair = Skia.Image.MakeImage({ width: texture.width, height: texture.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Opaque }, data, texture.width * 4);
                if (!hair) throw Error('live-edit-hair-failed'); own(hair);
                current = program(HAIR_SHADER, [s.hair.strength, ['solid', 'ombre', 'highlights'].indexOf(s.hair.mode), texture.top, texture.span, h, ...hairRgb(s.hair.shade), ...hairRgb(s.hair.shade2)], [current, shader(hair, texture.width, texture.height)]);
            }
        }
        const recorder = own(Skia.PictureRecorder()), canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, w, h));
        const paint = own(Skia.Paint()); paint.setShader(current); canvas.drawPaint(paint);
        return recorder.finishRecordingAsPicture();
    } finally { resources.reverse().forEach(r => r.dispose()); }
}
