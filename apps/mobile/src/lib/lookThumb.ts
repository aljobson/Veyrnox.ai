import { createResizer } from './chatResizer';

export const THUMB_EDGE = 160;
// One small copy of the photo, so nine strip previews do not each decode the full picture.
export async function makeThumb(uri: string): Promise<string | null> {
    try {
        const out = await createResizer().prepare({ uri } as never, THUMB_EDGE);
        return out.uri;
    } catch { return null; }
}
