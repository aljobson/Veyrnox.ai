import { RESIZE_UNAVAILABLE, scaledSize, type ImageResizer } from './chatAttach';

// The phone-photo resizer (ADR-0167): scale to the long-edge cap, keep the picture the right way up, and re-encode as JPEG.
// Re-encoding is what drops the EXIF block (camera, time, GPS) and turns HEIC into something the server accepts; a photo is
// never sent as picked. Backed by expo-image-manipulator, a native module.
interface Rendered {
    readonly width: number;
    readonly height: number;
    saveAsync(options: { compress: number; format: string }): Promise<{ uri: string; width: number; height: number }>;
}
interface Context {
    resize(size: { width: number; height: number }): Context;
    renderAsync(): Promise<Rendered>;
}
export interface ManipulatorLib {
    readonly ImageManipulator: { manipulate(uri: string): Context };
    readonly SaveFormat: { readonly JPEG: string };
}

export const JPEG_QUALITY = 0.9;

// Loaded on first use, so a JavaScript update that reaches a build made before the native module was added reads as "resize
// unavailable" (the photo is refused with the same words) instead of crashing.
function loadManipulator(): ManipulatorLib {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily; see above
        return require('expo-image-manipulator') as ManipulatorLib;
    } catch {
        throw new Error(RESIZE_UNAVAILABLE);
    }
}

export function createResizer(load: () => ManipulatorLib = loadManipulator): ImageResizer {
    return {
        async prepare(image, maxEdge) {
            const lib = load();
            // Rendering applies the camera's rotation, so the size read here is the size the person sees. The picker's own
            // width and height can be the unrotated ones, which would cap the wrong edge.
            const upright = await lib.ImageManipulator.manipulate(image.uri).renderAsync();
            const target = scaledSize(upright.width, upright.height, maxEdge);
            const out = target.width === upright.width && target.height === upright.height ? upright : await lib.ImageManipulator.manipulate(image.uri).resize(target).renderAsync();
            const saved = await out.saveAsync({ compress: JPEG_QUALITY, format: lib.SaveFormat.JPEG });
            return { uri: saved.uri, contentType: 'image/jpeg' };
        },
    };
}
