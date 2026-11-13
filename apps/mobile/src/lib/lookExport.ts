import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import type { Look } from './instantLooks';
import { normalizeStack, type Stack } from './liveEdit/engine';
import type { FrameId, Inference } from './liveEdit/protocol';

type ExportFormat = 'png' | 'jpeg';

// Lazy native import preserves the existing face-filter flow's startup behaviour.
export async function renderEffects(uri: string, stack: Stack, inference: Inference | null, ids: FrameId, format: ExportFormat = 'png'): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Skia, ImageFormat } = require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { renderEffectStack } = require('./liveEdit/renderEffectStack') as typeof import('./liveEdit/renderEffectStack');
    const data = await Skia.Data.fromURI(uri);
    const image = Skia.Image.MakeImageFromEncoded(data); data.dispose();
    if (!image) throw Error('look_export_failed');
    const surface = Skia.Surface.Make(image.width(), image.height());
    if (!surface) { image.dispose(); throw Error('look_export_failed'); }
    let bytes: Uint8Array;
    try {
        const picture = renderEffectStack({ image, ...ids }, stack, inference);
        try { surface.getCanvas().drawPicture(picture); surface.flush(); }
        finally { picture.dispose(); }
        const snapshot = surface.makeImageSnapshot();
        try {
            bytes = snapshot.encodeToBytes(format === 'jpeg' ? ImageFormat.JPEG : ImageFormat.PNG, format === 'jpeg' ? 92 : 100);
            if (!bytes) throw Error('look_export_failed');
        } finally { snapshot.dispose(); }
    } finally { surface.dispose(); image.dispose(); }
    // Release full-resolution native buffers before writing the encoded cache copy.
    let file: File | undefined;
    try {
        file = new File(Paths.cache, `veyrnox-look-${Date.now()}-${Math.random().toString(36).slice(2)}.${format === 'jpeg' ? 'jpg' : 'png'}`);
        file.create({ overwrite: false }); file.write(bytes); return file.uri;
    } catch (error) { try { if (file?.exists) file.delete(); } catch { /* OS cache cleanup */ } throw error; }
}
export function renderLook(uri: string, look: Look): Promise<string> {
    return renderEffects(uri, normalizeStack({ look: look.id, strength: look.strength }), null, { sourceId: 1, frameId: 1 }, 'jpeg');
}
export async function saveEffectsToPhotos(uri: string, stack: Stack, inference: Inference | null, ids: FrameId, stillOwned: () => boolean, format: ExportFormat = 'png'): Promise<boolean> {
    if (!stillOwned()) throw Error('look_export_cancelled');
    const permission = await requestPermissionsAsync(true);
    if (!stillOwned()) throw Error('look_export_cancelled');
    if (!permission.granted) return false;
    const rendered = await renderEffects(uri, stack, inference, ids, format);
    try {
        if (!stillOwned()) throw Error('look_export_cancelled');
        await Asset.create(rendered);
    } finally { try { new File(rendered).delete(); } catch { /* OS cache cleanup */ } }
    return true;
}
export function saveLookToPhotos(uri: string, look: Look, stillOwned: () => boolean = () => true): Promise<boolean> {
    return saveEffectsToPhotos(uri, normalizeStack({ look: look.id, strength: look.strength }), null, { sourceId: 1, frameId: 1 }, stillOwned, 'jpeg');
}
