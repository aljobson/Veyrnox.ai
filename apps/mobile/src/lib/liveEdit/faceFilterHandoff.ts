import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { discardCacheCopy } from '../cacheFiles';
import type { PickedFile } from '../sources';

// Live Edit offers its current photo to the AI wig flow (Face Filters) exactly once, as a cache copy the receiver owns.
// An unclaimed copy is deleted when it is replaced, cleared, or claimed under another account, so no file is left behind.
type Offer = { owner: string; file: PickedFile };
let pending: Offer | null = null;

export function clearHandoff(): void { if (pending) discardCacheCopy(pending.file.uri); pending = null; }
export function offerPhoto(owner: string, file: PickedFile): void { clearHandoff(); pending = { owner, file }; }
export function takeOffer(owner: string): PickedFile | null {
    const offer = pending; pending = null;
    if (!offer) return null;
    if (offer.owner !== owner) { discardCacheCopy(offer.file.uri); return null; }
    return offer.file;
}

/** A JPEG copy of an editor photo for upload: the editor keeps full-size PNGs, which can exceed the server's size limit. */
export async function jpegCopy(uri: string): Promise<PickedFile> {
    const context = ImageManipulator.manipulate(uri);
    let saved: string | undefined;
    try {
        const image = await context.renderAsync();
        try {
            const out = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
            saved = out.uri;
            return { uri: out.uri, size: new File(out.uri).size, mimeType: 'image/jpeg', width: out.width, height: out.height };
        } finally { image.release(); }
    } catch (error) { discardCacheCopy(saved); throw error; }
    finally { context.release(); }
}
