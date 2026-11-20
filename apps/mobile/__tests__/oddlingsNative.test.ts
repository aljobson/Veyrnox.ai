import { puppetUniforms } from '../src/lib/oddlings/puppetSksl';
import { prepareNativePuppet, puppetEffect, validatePuppetShader } from '../src/lib/oddlings/puppetNative';
import { puppetRig } from '../../../app/veyrnox/_lib/oddlingPuppetRigs.js';
jest.mock('@shopify/react-native-skia', () => require('@shopify/react-native-skia/lib/commonjs/skia/types'));
const CanvasKitInit = require('canvaskit-wasm/bin/full/canvaskit');
let api: any;
beforeAll(async () => { api = require('@shopify/react-native-skia/lib/commonjs/mock').Mock(await CanvasKitInit({})); });
function encoded(width: number, height: number) {
    const surface = api.Skia.Surface.Make(width, height);
    surface.getCanvas().clear(api.Skia.Color('#4488cc')); surface.flush();
    const image = surface.makeImageSnapshot();
    try { return image.encodeToBytes(api.ImageFormat.PNG); }
    finally { image.dispose(); surface.dispose(); }
}
test('native decode rejects corrupt data and wrong dimensions', async () => {
    const signal = new AbortController().signal, rig = puppetRig('pip-parcel')!;
    for (const bytes of [new Uint8Array([1, 2, 3]), encoded(16, 24)]) {
        await expect(prepareNativePuppet(api.Skia, bytes, rig, signal)).rejects.toThrow('puppet_portrait_dimensions');
    }
});
test('native decode, mask, preparation and image creation produce disposable portrait layers', async () => {
    const layers = await prepareNativePuppet(api.Skia, encoded(1024, 1536), puppetRig('pip-parcel')!, new AbortController().signal);
    expect([layers.plate.width(), layers.plate.height(), layers.head.width(), layers.head.height()]).toEqual([1024, 1536, 1024, 1536]);
    const plateDispose = jest.spyOn(layers.plate, 'dispose'), headDispose = jest.spyOn(layers.head, 'dispose');
    layers.dispose(); layers.dispose();
    expect(plateDispose).toHaveBeenCalledTimes(1); expect(headDispose).toHaveBeenCalledTimes(1);
});
test('a null shader compilation fails rather than rendering an empty preview', () => {
    jest.isolateModules(() => {
        const { puppetEffect } = require('../src/lib/oddlings/puppetNative');
        const Make = jest.fn(() => null);
        expect(() => puppetEffect({ RuntimeEffect: { Make } })).toThrow('puppet_shader_failed');
        expect(() => puppetEffect({ RuntimeEffect: { Make } })).toThrow('puppet_shader_failed');
        expect(Make).toHaveBeenCalledTimes(1);
    });
});

test.each(['success', 'null', 'throw'])('binding probe handles %s and disposes temporary shaders', async result => {
    const rig = puppetRig('pip-parcel')!;
    const layers = await prepareNativePuppet(api.Skia, encoded(1024, 1536), rig, new AbortController().signal);
    const effect = puppetEffect(api.Skia);
    const bind = jest.spyOn(effect, 'makeShaderWithChildren');
    const childDisposals: jest.SpyInstance[] = [];
    const imageSpies = [layers.plate, layers.head].map(image => {
        const original = image.makeShaderOptions.bind(image);
        return jest.spyOn(image, 'makeShaderOptions').mockImplementation((...args) => {
            const shader = original(...args);
            childDisposals.push(jest.spyOn(shader, 'dispose'));
            return shader;
        });
    });
    let boundDisposal: jest.SpyInstance | undefined;
    if (result === 'null') bind.mockReturnValue(null as any);
    else if (result === 'throw') bind.mockImplementation(() => { throw new Error('binding failed'); });
    else {
        const original = bind.getMockImplementation();
        bind.mockImplementation(function (...args) {
            const shader = original!.apply(effect, args);
            boundDisposal = jest.spyOn(shader, 'dispose');
            return shader;
        });
    }
    try {
        const uniforms = puppetUniforms(rig, layers.lids, 'pip-parcel', 0, [360, 540]);
        const probe = () => validatePuppetShader(api.Skia, layers, uniforms);
        if (result === 'success') { expect(probe).not.toThrow(); expect(boundDisposal).toHaveBeenCalledTimes(1); }
        else expect(probe).toThrow();
        expect(bind).toHaveBeenCalledWith(api.processUniforms(effect, uniforms), expect.any(Array));
        expect(childDisposals).toHaveLength(2);
        childDisposals.forEach(dispose => expect(dispose).toHaveBeenCalledTimes(1));
        imageSpies.forEach(spy => expect(spy).toHaveBeenCalledWith(api.TileMode.Clamp, api.TileMode.Clamp, api.FilterMode.Linear, api.MipmapMode.None));
    } finally { bind.mockRestore(); imageSpies.forEach(spy => spy.mockRestore()); layers.dispose(); }
});
