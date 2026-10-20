// "Animate this portrait": the web sends a cast portrait to Create as the start image of an image-to-video model with the
// opening move written into the prompt. The phone does the same through Create's own file slot: it opens Create with
// the words filled in and `startOddling` set, and Create loads the portrait into the model's image slot through the
// ordinary upload path. Nothing here charges or sends anything; the price is the catalog's, never worked out here.
import { Directory, File, Paths } from 'expo-file-system';
import { findOddling, portraitUrl } from './oddlings';
import { MOTIONS } from './oddlingsBuilder';
import { estimateCredits, isSupported, kindOf, type CatalogModel } from './media';
import type { PickedFile } from './sources';

// The web prefers this model when it is open and otherwise takes the first image-to-video model that fits.
export const ANIMATE_MODEL_ID = 'kling-3.0-i2v';
export const ANIMATE_SECONDS = 5;
export const PORTRAIT_BYTES_MAX = 5 * 1024 * 1024;

// An open video model whose only required file is the image, that can be bought at five seconds.
export function animationModel(models: readonly CatalogModel[]): CatalogModel | null {
    const eligible = models.filter((m) => {
        if (!isSupported(m) || kindOf(m.modality) !== 'video' || !m.durations.includes(ANIMATE_SECONDS)) return false;
        const media = m.capabilities?.media ?? {};
        return media.image?.required === true && !Object.entries(media).some(([slot, spec]) => slot !== 'image' && spec.required === true);
    });
    return eligible.find((m) => m.id === ANIMATE_MODEL_ID) ?? eligible[0] ?? null;
}

export const animationCredits = (model: CatalogModel): number => estimateCredits(model, ANIMATE_SECONDS);

// The web's words, word for word (a test compares them with the web file for every character and move).
export function animationPrompt(name: string, motionId = ''): string {
    const motion = MOTIONS.find((m) => m.id === motionId) ?? MOTIONS[0];
    return `Animate ${name}, the exact single character in the start image. The character ${motion.phrase}. Preserve the face, body shape and size, outfit colors and fit, props, and exact sculptural hairstyle from the image throughout. Keep the whole silhouette and hairstyle in frame, stable camera, natural coherent movement, same background and lighting.`;
}

export function animateLink(model: CatalogModel, oddlingId: string, motionId = '') {
    const oddling = findOddling(oddlingId);
    if (!oddling) return null;
    return {
        pathname: '/create/[modelId]',
        params: { modelId: model.id, prompt: animationPrompt(oddling.name, motionId), duration: String(ANIMATE_SECONDS), startOddling: oddling.id },
    } as const;
}

// The `startOddling` parameter is only ever one of the 72 cast ids.
export const startOddlingId = (param: unknown): string | null => (typeof param === 'string' ? findOddling(param)?.id ?? null : null);

// "RIFF", four size bytes, "WEBP".
export function looksLikeWebp(bytes: Uint8Array): boolean {
    const at = (i: number, text: string) => [...text].every((ch, k) => bytes[i + k] === ch.charCodeAt(0));
    return bytes.length > 12 && bytes.length <= PORTRAIT_BYTES_MAX && at(0, 'RIFF') && at(8, 'WEBP');
}

// The portrait as a file in the cache, in the shape the file slot takes. The web fetches the same public picture.
export async function portraitAsPickedFile(oddlingId: string): Promise<PickedFile | null> {
    if (!findOddling(oddlingId)) return null;
    const dir = new Directory(Paths.cache, 'veyrnox-oddlings');
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `animate-${oddlingId}.webp`);
    if (!file.exists) await File.downloadFileAsync(portraitUrl(oddlingId), file, { idempotent: true });
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikeWebp(bytes)) {
        if (file.exists) file.delete();
        return null;
    }
    return { uri: file.uri, mimeType: 'image/webp', size: bytes.length };
}
