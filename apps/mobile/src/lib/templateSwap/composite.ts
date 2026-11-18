import type { Skia, SkImage } from '@shopify/react-native-skia';
import type { CompositePlan } from './photoPlan';
// Skia 2.14 enums: RGBA_8888=4, Unpremul=3, DstIn=6, PNG=4.
export function encodeComposite(skia: typeof Skia, image: SkImage, plan: CompositePlan): [Uint8Array, Uint8Array] {
    const surface = skia.Surface.Make(plan.frontal.width, plan.frontal.height);
    if (!surface) throw Error('cutout_failed');
    const data = skia.Data.fromBytes(plan.rgba);
    const mask = skia.Image.MakeImage({ ...plan.frontal, colorType: 4, alphaType: 3 }, data, plan.frontal.width * 4);
    const paint = skia.Paint();
    let composite: SkImage | undefined;
    try {
        if (!mask) throw Error('cutout_failed');
        const canvas = surface.getCanvas(), rect = { x: 0, y: 0, ...plan.frontal };
        canvas.clear(skia.Color(plan.background));
        canvas.saveLayer();
        canvas.drawImageRect(image, { x: 0, y: 0, width: image.width(), height: image.height() }, rect, paint);
        paint.setBlendMode(6);
        canvas.drawImage(mask, 0, 0, paint);
        canvas.restore(); surface.flush(); composite = surface.makeImageSnapshot();
        const cropped = skia.Surface.Make(plan.crop.width, plan.crop.height);
        if (!cropped) throw Error('cutout_failed');
        try {
            paint.setBlendMode(3); // SrcOver for drawing the already flattened composite.
            cropped.getCanvas().drawImageRect(composite, plan.cropBox, { x: 0, y: 0, ...plan.crop }, paint);
            cropped.flush(); const snapshot = cropped.makeImageSnapshot();
            try {
                const frontal = composite.encodeToBytes(4), crop = snapshot.encodeToBytes(4);
                if (!frontal || !crop) throw Error('cutout_failed');
                return [frontal, crop];
            } finally { snapshot.dispose(); }
        } finally { cropped.dispose(); }
    } finally { composite?.dispose(); paint.dispose(); mask?.dispose(); data.dispose(); surface.dispose(); }
}
