import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { imageDimensions } from '../../../../../lib/uploadSource.js';
import { inputTransform, mapBox } from '../../../../../lib/templateSwapCutout.mjs';
import type { PickedAsset } from '../pickedImage';
import { discardCacheCopy } from '../cacheFiles';
import { validateFrame, type Frame } from '../liveEdit/protocol';
import { swapMasks, type SwapInference } from '../liveEdit/swapProtocol';
import { originalSize, requireOk, compositePlan } from './photoPlan';
import { encodeComposite } from './composite';
import { deleteSwapFile, writeSwapPng } from './files';
import type { SwapFile } from '../../../../../app/veyrnox/_lib/templateSwapClient.mjs';
export const LOAD_BOUNDS = { maxWidth: 1536, maxHeight: 1536 } as const;
const check = (signal: AbortSignal) => { if (signal.aborted) throw Object.assign(Error('Cancelled'), { name: 'AbortError' }); };
async function headerSize(uri: string) {
    try {
        const file = new File(uri), handle = file.open();
        try { return imageDimensions(await handle.readBytes(Math.min(file.size, 1024 * 1024))); }
        finally { handle.close(); }
    } catch { return null; }
}
export async function prepareSwapPhoto(asset: PickedAsset, signal: AbortSignal, readHeader = headerSize) {
    check(signal);
    if (!asset || !/^(file|content):\/\//.test(asset.uri)) throw Error('invalid_image');
    // Validate BEFORE every source load, including HEIC/AVIF conversion. Unverifiable headers fail closed.
    const original = originalSize(asset.width && asset.height ? asset : await readHeader(asset.uri));
    check(signal);
    const context = ImageManipulator.manipulate(asset.uri, LOAD_BOUNDS);
    let full: string | undefined, small: string | undefined;
    try {
        // Native load applies EXIF orientation before render; this same bounded path converts HEIC/AVIF to PNG.
        const image = await context.renderAsync();
        try {
            check(signal);
            const rotated = original.width !== original.height && Math.sign(image.width - image.height) !== Math.sign(original.width - original.height);
            // B1 coordinates start AFTER EXIF normalization, including mirrored/180-degree inputs.
            const orientedOriginal = rotated ? { width: original.height, height: original.width } : original;
            const transform = requireOk(inputTransform(orientedOriginal));
            if (image.width > 1536 || image.height > 1536) throw Error('photo_too_large');
            const saved = await image.saveAsync({ format: SaveFormat.PNG }); full = saved.uri;
            check(signal);
            const resized = ImageManipulator.manipulate(full, LOAD_BOUNDS);
            try {
                const scale = Math.min(1, 384 / Math.max(image.width, image.height));
                resized.resize({ width: Math.round(image.width * scale), height: Math.round(image.height * scale) });
                const thumb = await resized.renderAsync();
                try {
                    const encoded = await thumb.saveAsync({ format: SaveFormat.JPEG, compress: .85, base64: true }); small = encoded.uri;
                    check(signal);
                    const frame: Frame = { sourceId: 1, frameId: 1, width: encoded.width, height: encoded.height, jpeg: `data:image/jpeg;base64,${encoded.base64}` };
                    validateFrame(frame);
                    return { uri: full, width: image.width, height: image.height, frame, transform: { ...transform, originalSource: original, orientation: 'native-normalized', width: image.width, height: image.height, scaleX: image.width / (rotated ? original.height : original.width), scaleY: image.height / (rotated ? original.width : original.height) } };
                } finally { thumb.release(); }
            } finally { resized.release(); }
        } finally { image.release(); }
    } catch (error) { discardCacheCopy(full); throw error; }
    finally { context.release(); discardCacheCopy(small); }
}
export async function processSwapPhoto(asset: PickedAsset, signal: AbortSignal, detect: (frame: Frame, signal: AbortSignal) => Promise<SwapInference>) {
    const files: SwapFile[] = [];
    let prepared: Awaited<ReturnType<typeof prepareSwapPhoto>> | undefined;
    try {
        prepared = await prepareSwapPhoto(asset, signal);
        const detected = await detect(prepared.frame, signal); check(signal);
        // Face authority precedes masks, including zero/two-face outputs which contain no mask.
        if (detected.count !== 1) throw Error(detected.count === 0 ? 'no_face' : 'several_people');
        const plan = compositePlan(prepared, detected, swapMasks(detected)); check(signal);
        // Lazy native adapter: importing the store does not start Skia or a WebView.
        const { Skia } = await import('@shopify/react-native-skia'); check(signal);
        const data = Skia.Data.fromBytes(await new File(prepared.uri).bytes());
        const image = Skia.Image.MakeImageFromEncoded(data);
        try {
            if (!image) throw Error('invalid_image');
            const pair = encodeComposite(Skia, image, plan); check(signal);
            files.push(writeSwapPng(pair[0], plan.frontal)); files.push(writeSwapPng(pair[1], plan.crop)); check(signal);
            return { files, transform: prepared.transform, faceBox: mapBox(plan.faceBox, prepared.transform) };
        } finally { image?.dispose(); data.dispose(); }
    } catch (error) { files.forEach(f => deleteSwapFile(f.uri)); throw error; }
    finally { discardCacheCopy(prepared?.uri); discardCacheCopy(asset.uri); }
}
