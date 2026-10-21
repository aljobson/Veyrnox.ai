/** @jest-environment ./__tests__/support/canvasKitEnv.js */
import { exportDrawing } from '../src/lib/drawRender';
const { Skia, ImageFormat, ColorType, AlphaType } = require('@shopify/react-native-skia/lib/commonjs/mock').Mock((globalThis as any).CanvasKit);

test('pixel export keeps source dimensions and erases marks without erasing the opaque photo', () => {
    const surface = Skia.Surface.Make(300, 200);
    surface.getCanvas().clear(Skia.Color('#0000ff'));
    surface.flush();
    const original = surface.makeImageSnapshot();
    const data = Skia.Data.fromBytes(original.encodeToBytes(ImageFormat.PNG));
    const photo = Skia.Image.MakeImageFromEncoded(data);
    original.dispose(); data.dispose(); surface.dispose();
    const bytes = exportDrawing(Skia, photo, [
        { kind: 'pen', color: '#ff0000', width: 20, points: [{ x: 20, y: 80 }, { x: 200, y: 80 }] },
        { kind: 'erase', color: '#ffffff', width: 30, points: [{ x: 100, y: 60 }, { x: 100, y: 100 }] },
        { kind: 'pen', color: '#ff0000', width: 10, points: [{ x: 240, y: 150 }] },
    ]);
    const exportedData = Skia.Data.fromBytes(bytes);
    const image = Skia.Image.MakeImageFromEncoded(exportedData);
    expect([image.width(), image.height()]).toEqual([300, 200]);
    const pixels = image.readPixels(0, 0, { width: 300, height: 200, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
    const pixel = (x: number, y: number) => Array.from(pixels.slice((y * 300 + x) * 4, (y * 300 + x + 1) * 4));
    expect(pixel(40, 80)).toEqual([255, 0, 0, 255]);
    expect(pixel(100, 80)).toEqual([0, 0, 255, 255]);
    expect(pixel(280, 180)).toEqual([0, 0, 255, 255]);
    expect(pixel(240, 150)).toEqual([255, 0, 0, 255]);
    expect(Array.from(pixels as Uint8Array).filter((_, i) => i % 4 === 3).every(alpha => alpha === 255)).toBe(true);
    image.dispose(); exportedData.dispose(); photo.dispose();
});

test('export rejects unavailable surfaces and disposes failed encodes', () => {
    expect(() => exportDrawing({ ...Skia, Surface: { Make: () => null } }, { width: () => 4, height: () => 5 } as any, [])).toThrow('draw_export_failed');
    const snapshot = { encodeToBytes: () => null, dispose: jest.fn() };
    const surface = { getCanvas: () => ({ save() {}, scale() {}, clipRect() {}, drawImage() {}, saveLayer() {}, restore() {} }), flush() {}, makeImageSnapshot: () => snapshot, dispose: jest.fn() };
    expect(() => exportDrawing({ ...Skia, Surface: { Make: () => surface } }, { width: () => 4, height: () => 5 } as any, [])).toThrow('draw_export_failed');
    expect(snapshot.dispose).toHaveBeenCalledTimes(1);
    expect(surface.dispose).toHaveBeenCalledTimes(1);
});
