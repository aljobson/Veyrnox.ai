import { act } from 'react';
import { createRoot, type Root } from 'test-renderer';
import { AccessibilityInfo, AppState, PixelRatio, type AppStateStatus } from 'react-native';
import { NavigationContext } from 'expo-router/react-navigation';
import { WOBNIMO_PROGRAMS } from '../src/lib/wobnimoPrograms.generated';
import { WobnimoView } from '../src/components/WobnimoView';
import { createWobnimoRenderer, WobnimoEngine } from '../src/lib/wobnimoNative';
import type { WobnimoState } from '../src/lib/veyCharacterChoice';

let mockFocused = true;
const mockDraw = jest.fn(), mockDispose = jest.fn(), mockResize = jest.fn();
jest.mock('@shopify/react-native-skia', () => {
    const React = require('react');
    return { Skia: {}, Canvas: (props: any) => React.createElement('Canvas', props), Image: (props: any) => React.createElement('SkImage', props) };
});
jest.mock('../src/lib/wobnimoNative', () => ({
    ...jest.requireActual('../src/lib/wobnimoNative'),
    createWobnimoRenderer: jest.fn(() => ({ draw: mockDraw, dispose: mockDispose, resize: mockResize })),
}));
let root: Root, now: number, frames: Map<number, FrameRequestCallback>, next: number;
let onApp: (state: AppStateStatus) => void, onMotion: (value: boolean) => void;
let onFailure: jest.Mock, removed: jest.Mock[], images: { dispose: jest.Mock }[];
let state: WobnimoState;
let navigation: any;
let focusListeners: Map<string, () => void>;
const navigationValue = () => ({
    isFocused: () => mockFocused,
    addListener: jest.fn((event: string, callback: () => void) => {
        focusListeners.set(event, callback);
        return jest.fn(() => focusListeners.delete(event));
    }),
});
const render = async () => { await act(async () => root.render(<NavigationContext.Provider value={navigation}><WobnimoView character="volt" state={state} width={64} onFailure={onFailure} /></NavigationContext.Provider>)); };
const step = async (ms = 34) => {
    now += ms;
    const ready = [...frames.values()]; frames.clear();
    await act(async () => ready.forEach(callback => callback(now)));
};
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(); frames = new Map(); next = 0; now = 0; removed = []; images = [];
    state = 'idle'; navigation = undefined; focusListeners = new Map(); mockFocused = true; onFailure = jest.fn();
    mockDraw.mockReset().mockImplementation(() => {
        const image = { dispose: jest.fn() }; images.push(image); return image;
    });
    mockDispose.mockClear(); mockResize.mockClear();
    jest.mocked(createWobnimoRenderer).mockReset().mockImplementation(() => ({ draw: mockDraw, dispose: mockDispose, resize: mockResize }));
    jest.spyOn(global, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++next, callback); return next; });
    jest.spyOn(global, 'cancelAnimationFrame').mockImplementation(id => { if (id != null) frames.delete(id); });
    jest.spyOn(PixelRatio, 'get').mockReturnValue(3);
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => {
        onApp = callback; const remove = jest.fn(); removed.push(remove); return { remove };
    });
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_type, callback) => {
        onMotion = callback; const remove = jest.fn(); removed.push(remove); return { remove };
    });
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });

test('caps physical size, hides decorative art and forwards every state without rebuilding', async () => {
    const configure = jest.spyOn(WobnimoEngine.prototype, 'configure');
    await render(); await step();
    expect(createWobnimoRenderer).toHaveBeenCalledWith({}, 'volt', 128);
    expect(mockDraw.mock.calls[0][0].uResolution).toEqual([128, 128]);
    expect(root.container.queryAll(n => n.type === 'Canvas')[0].props.colorSpace).toBe('srgb');
    const art = root.container.queryAll(n => n.props.pointerEvents === 'none')[0];
    expect(art.props).toMatchObject({ accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' });
    for (const nextState of ['thinking', 'listening', 'speaking', 'sleeping', 'working', 'error', 'surprised', 'celebrating', 'sad', 'idle'] as const) {
        state = nextState; await render(); await step();
        expect(configure).toHaveBeenLastCalledWith(state, false);
    }
    expect(createWobnimoRenderer).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
});

test('throttles near 30 fps, pauses in background and off-focus, and resumes without elapsed-time catchup', async () => {
    navigation = navigationValue();
    await render(); await step(); await step(16);
    expect(mockDraw).toHaveBeenCalledTimes(1);
    await step(18); expect(mockDraw).toHaveBeenCalledTimes(2);
    await act(async () => onApp('background')); expect(frames.size).toBe(0);
    await step(10000); expect(mockDraw).toHaveBeenCalledTimes(2);
    await act(async () => onApp('active')); await step();
    expect(mockDraw).toHaveBeenCalledTimes(3);
    expect(mockDraw.mock.calls[2][0].uTime - mockDraw.mock.calls[1][0].uTime).toBeCloseTo(1 / 30);
    mockFocused = false; await act(async () => focusListeners.get('blur')!()); expect(frames.size).toBe(0);
    await step(); expect(mockDraw).toHaveBeenCalledTimes(3);
    mockFocused = true; await act(async () => focusListeners.get('focus')!()); await step(); expect(mockDraw).toHaveBeenCalledTimes(4);
    await act(async () => root.unmount()); expect(focusListeners.size).toBe(0); root = createRoot();
});

test('does not schedule frames while initially backgrounded', async () => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
    await render(); expect(frames.size).toBe(0); expect(mockDraw).not.toHaveBeenCalled();
});

test('mirrors reduced motion: two settled frames, no FX, then stops until state or preference changes', async () => {
    jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
    await render(); await step(); await step();
    expect(frames.size).toBe(0); expect(mockDraw).toHaveBeenCalledTimes(2);
    expect(mockDraw.mock.calls[1][0]).toMatchObject({ uTime: 0, uFxCount: 0 });
    state = 'sleeping'; await render(); await step(); await step();
    expect(mockDraw).toHaveBeenCalledTimes(4); expect(frames.size).toBe(0);
    await act(async () => onMotion(false)); await step();
    expect(frames.size).toBe(1); expect(mockDraw.mock.calls[4][0].uTime).toBeGreaterThan(0);
});

test('reports compile/setup and frame errors once and stops scheduling', async () => {
    jest.mocked(createWobnimoRenderer).mockImplementationOnce(() => { throw new Error('compile'); });
    await render(); expect(onFailure).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
    await act(async () => root.unmount()); root = createRoot(); onFailure.mockClear();
    mockDraw.mockImplementationOnce(() => { throw new Error('GPU'); });
    await render(); await step(); expect(onFailure).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
    state = 'sad'; await render(); expect(frames.size).toBe(0);
});

test('disposes snapshots, renderer, event listeners and scheduled frame on unmount', async () => {
    await render(); await step(); await step();
    expect(images[0].dispose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    expect(mockDispose).toHaveBeenCalledTimes(1);
    expect(images.every(image => image.dispose.mock.calls.length === 1)).toBe(true);
    expect(removed.every(remove => remove.mock.calls.length === 1)).toBe(true);
    expect(frames.size).toBe(0); root = createRoot();
});

test('renders outside any navigation provider without mocking useIsFocused', async () => {
    await act(async () => root.render(<WobnimoView character="volt" state="idle" width={64} onFailure={onFailure} />));
    await step();
    expect(mockDraw).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
});

// Retain the real renderer and cache, replacing only Skia's native handles.
function nativeHandles(readback: 'ok' | 'null' | 'throw' = 'ok') {
    const layout = WOBNIMO_PROGRAMS.volt.uniforms;
    const effect = {
        getUniformCount: () => layout.length,
        getUniformName: (i: number) => layout[i].name,
        getUniform: (i: number) => ({ columns: layout[i].size, rows: 1, isInteger: layout[i].integer }),
        getUniformFloatCount: () => layout.reduce((sum, u) => sum + u.size, 0),
        makeShader: () => ({ dispose: jest.fn() }), dispose: jest.fn(),
    };
    const rasters: any[] = [], textures: any[] = [], surfaces: any[] = [];
    const skia = {
        RuntimeEffect: { Make: jest.fn(() => effect) },
        Surface: { MakeOffscreen: jest.fn(() => {
            const surface = {
                getCanvas: () => ({ clear() {}, drawPaint() {} }), flush() {}, dispose: jest.fn(),
                makeImageSnapshot: () => {
                    const raster = { textureBacked: false, dispose: jest.fn() };
                    const texture = { textureBacked: true, makeNonTextureImage: jest.fn(() => {
                        if (readback === 'throw') throw new Error('readback');
                        return readback === 'null' ? null : raster;
                    }), dispose: jest.fn() };
                    rasters.push(raster); textures.push(texture); return texture;
                },
            };
            surfaces.push(surface); return surface;
        }) },
        Paint: () => ({ setShader() {}, dispose: jest.fn() }), Color: () => [],
    };
    const real = jest.requireActual('../src/lib/wobnimoNative') as typeof import('../src/lib/wobnimoNative');
    jest.mocked(createWobnimoRenderer).mockImplementation((_skia, character, size) => real.createWobnimoRenderer(skia as any, character, size));
    return { skia, effect, rasters, textures, surfaces };
}

test('only raster images reach the display tree and texture snapshots are disposed', async () => {
    const handles = nativeHandles();
    await render(); await step();
    const displayed = root.container.queryAll(n => n.type === 'SkImage')[0].props.image;
    expect(displayed).toBe(handles.rasters[0]);
    expect(displayed.textureBacked).toBe(false);
    expect(handles.textures[0].makeNonTextureImage).toHaveBeenCalledTimes(1);
    expect(handles.textures[0].dispose).toHaveBeenCalledTimes(1);
    expect(handles.rasters[0].dispose).not.toHaveBeenCalled();
    await act(async () => root.unmount());
    expect(handles.rasters[0].dispose).toHaveBeenCalledTimes(1); root = createRoot();
});

test.each(['null', 'throw'] as const)('readback failure (%s) disposes the texture and calls onFailure', async failure => {
    const handles = nativeHandles(failure);
    await render(); await step();
    expect(handles.textures[0].dispose).toHaveBeenCalledTimes(1);
    expect(root.container.queryAll(n => n.type === 'SkImage')).toHaveLength(0);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
});

test('two mounts compile a character once and own separate surfaces, retaining the cached effect', async () => {
    const handles = nativeHandles();
    await act(async () => root.render(<>
        <WobnimoView character="volt" state="idle" width={64} />
        <WobnimoView character="volt" state="idle" width={80} />
    </>));
    expect(handles.skia.RuntimeEffect.Make).toHaveBeenCalledTimes(1);
    expect(handles.skia.Surface.MakeOffscreen).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
    expect(handles.effect.dispose).not.toHaveBeenCalled();
    expect(handles.surfaces.every(surface => surface.dispose.mock.calls.length === 1)).toBe(true);
    root = createRoot(); await render();
    expect(handles.skia.RuntimeEffect.Make).toHaveBeenCalledTimes(1);
});

test('adaptive quality samples RAF intervals, shrinks after sustained slow frames and stays at or above 0.55x', async () => {
    await render(); await step(1000 / 60);
    for (let i = 0; i < 130; i++) await step(1000 / 60);
    // A 33ms draw interval on a 60Hz clock is intentional, not a slow RAF.
    expect(mockResize.mock.calls.every(([size]) => size === 128)).toBe(true);
    for (let i = 0; i < 20; i++) await step(40);
    expect(mockResize).toHaveBeenLastCalledWith(128);
    await step(40);
    expect(mockResize).toHaveBeenLastCalledWith(Math.round(128 * 0.85));
    for (let i = 0; i < 21 * 8; i++) await step(40);
    expect(mockResize).toHaveBeenLastCalledWith(Math.round(128 * 0.55));
    expect(mockResize.mock.calls.every(([size]) => size >= Math.round(128 * 0.55))).toBe(true);
    expect(mockDraw.mock.calls.at(-1)![0].uResolution).toEqual([70, 70]);
    for (let i = 0; i < 121; i++) await step(1000 / 60);
    await step(1000 / 60); // publish the recovered target on the next throttled draw
    expect(mockResize.mock.calls.at(-1)![0]).toBeGreaterThan(70);
    expect(createWobnimoRenderer).toHaveBeenCalledTimes(1);
});
