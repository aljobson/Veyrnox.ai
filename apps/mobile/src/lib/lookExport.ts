import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { lookMatrix, type Look } from './instantLooks';

declare const require: (id: string) => any;
// Native Skia loads only when a look is saved, so the screen opens without it.
const skia = () => (require('@shopify/react-native-skia') as typeof import('@shopify/react-native-skia')).Skia;
const JPEG = 3; // Skia ImageFormat.JPEG
const QUALITY = 92;

// Renders the look at the photo's own pixel size and returns a cache file.
export async function renderLook(uri: string, look: Look): Promise<string> {
    const Skia = skia();
    const data = await Skia.Data.fromURI(uri);
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) throw new Error('look_export_failed');
    const surface = Skia.Surface.Make(image.width(), image.height());
    if (!surface) { image.dispose(); throw new Error('look_export_failed'); }
    const paint = Skia.Paint();
    try {
        const filter = Skia.ColorFilter.MakeMatrix(lookMatrix(look));
        paint.setColorFilter(filter);
        surface.getCanvas().drawImage(image, 0, 0, paint);
        surface.flush();
        const snapshot = surface.makeImageSnapshot();
        try {
            const bytes = snapshot.encodeToBytes(JPEG, QUALITY);
            if (!bytes) throw new Error('look_export_failed');
            const file = new File(Paths.cache, `veyrnox-look-${Date.now()}.jpg`);
            file.create({ overwrite: true });
            file.write(bytes);
            return file.uri;
        } finally { snapshot.dispose(); }
    } finally { paint.dispose(); surface.dispose(); image.dispose(); }
}

// Returns false when the person declined add-only photo access, and throws look_export_cancelled when the screen was left or the account changed meanwhile.
export async function saveLookToPhotos(uri: string, look: Look, stillOwned: () => boolean = () => true): Promise<boolean> {
    const permission = await requestPermissionsAsync(true);
    if (!stillOwned()) throw new Error('look_export_cancelled');
    if (!permission.granted) return false;
    const rendered = await renderLook(uri, look);
    try {
        // The account may have changed while this rendered: never write another account's photo.
        if (!stillOwned()) throw new Error('look_export_cancelled');
        await Asset.create(rendered);
    } finally { try { new File(rendered).delete(); } catch { /* cache copy is swept anyway */ } }
    return true;
}
