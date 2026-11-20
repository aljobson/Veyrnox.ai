import { PUPPET_SKSL, puppetUniforms } from '../src/lib/oddlings/puppetSksl';
import { expectedPuppetPixel } from './helpers/oddlingsShaderReference';
import type { PuppetRig } from '../src/lib/oddlings/puppetPrepare';
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit');
let api: any, effect: any;
const rig: PuppetRig = {
    head: [[300, 100], [800, 100], [800, 650], [300, 650]], pivot: [512, 650],
    eyes: [[420, 300, 45, 30], [650, 300, 45, 30]], chest: [512, 850, 300, 260],
    arms: [[270, 850, 200, 350], [750, 850, 200, 350]], lower: [512, 1250, 300, 300], tilt: 0.01,
};
const plate = new Uint8Array(1024 * 1536 * 4), head = new Uint8Array(plate.length);
for (let y = 0; y < 1536; y++) for (let x = 0; x < 1024; x++) {
    const i = (y * 1024 + x) * 4;
    plate.set([x % 256, Math.floor(y / 6), (x + y) % 256, 255], i);
    const a = x < 480 ? 0 : x < 540 ? 128 : 255;
    head.set([Math.round((255 - x % 256) * a / 255), Math.round((255 - Math.floor(y / 6)) * a / 255), Math.round((y % 256) * a / 255), a], i);
}
beforeAll(async () => {
    api = require('@shopify/react-native-skia/lib/commonjs/mock').Mock(await CanvasKitInit({}));
    effect = api.Skia.RuntimeEffect.Make(PUPPET_SKSL);
    expect(effect).not.toBeNull();
});
afterAll(() => effect?.dispose());
function render(u: ReturnType<typeof puppetUniforms>) {
    const { Skia, ColorType, AlphaType, TileMode, FilterMode, MipmapMode } = api;
    const [width, height] = u.viewSize;
    const resources: { dispose(): void }[] = [];
    try {
        const shaders = [plate, head].map((pixels, i) => {
            const data = Skia.Data.fromBytes(pixels); resources.push(data);
            const image = Skia.Image.MakeImage({ width: 1024, height: 1536, colorType: ColorType.RGBA_8888, alphaType: i ? AlphaType.Premul : AlphaType.Opaque }, data, 1024 * 4); resources.push(image);
            const shader = image.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None); resources.push(shader);
            return shader;
        });
        const names = Array.from({ length: effect.getUniformCount() }, (_, i) => effect.getUniformName(i) as keyof typeof u);
        expect([...names].sort()).toEqual(Object.keys(u).sort());
        const values = names.flatMap(name => u[name]);
        expect(values).toHaveLength(effect.getUniformFloatCount());
        const shader = effect.makeShaderWithChildren(values, shaders); resources.push(shader);
        const surface = Skia.Surface.Make(width, height); resources.push(surface);
        const paint = Skia.Paint(); resources.push(paint); paint.setShader(shader);
        surface.getCanvas().drawPaint(paint); surface.flush();
        const snapshot = surface.makeImageSnapshot(); resources.push(snapshot);
        return snapshot.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array;
    } finally { resources.reverse().forEach(resource => resource.dispose()); }
}
test.each([[360, 540], [300, 600], [512, 768]])('cover mapping and all warps match the reference at %sx%s', (width, height) => {
    for (const moving of [false, true]) {
        const uniforms = puppetUniforms(rig, [[0.7, 0.6, 0.5], [0.5, 0.7, 0.6]], 'pip-parcel', 0, [width, height]);
        uniforms.pose = moving ? [0.85, 0.025, 0.08, 4] : [0, 0, 0, 0];
        uniforms.pose2 = moving ? [0.8, -0.6, 0.7, 0.5] : [0, 0, 0, 0];
        const pixels = render(uniforms);
        const points = [[0.05, 0.1], [0.15, 0.5], [0.95, 0.8], [0.5, 0.4], [0.3, 0.55], [0.7, 0.6], [0.45, 0.85]];
        const scale = Math.max(width / 1024, height / 1536);
        // Explicit eye points exercise eyelid seams and coverage as well as body warps.
        points.push(...rig.eyes.map(([x, y]) => [((x - 512) * scale + width / 2) / width, ((y - 768) * scale + height / 2) / height]));
        for (const [px, py] of points) {
            const x = Math.floor(width * px), y = Math.floor(height * py);
            const expected = expectedPuppetPixel(plate, head, uniforms, x, y);
            const actual = Array.from(pixels.slice((y * width + x) * 4, (y * width + x + 1) * 4));
            actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThanOrEqual(3));
        }
    }
});
