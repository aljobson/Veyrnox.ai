import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { OddlingPortrait } from '../src/components/oddlings/OddlingPortrait';
import { t } from '../src/lib/i18n';

let mockFocused = true;
const mockRead = jest.fn(), mockPrepare = jest.fn(), mockValidate = jest.fn();
const mockCanvas = jest.fn((_props: any) => null);
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('@shopify/react-native-skia', () => ({ Skia: {} }));
jest.mock('../src/lib/oddlingsPortraitFile', () => ({ portraitBytesFor: (...args: any[]) => mockRead(...args) }));
jest.mock('../src/lib/oddlings/puppetNative', () => ({ prepareNativePuppet: (...args: any[]) => mockPrepare(...args), validatePuppetShader: (...args: any[]) => mockValidate(...args) }));
jest.mock('../src/components/oddlings/OddlingPuppetCanvas', () => ({
    OddlingPuppetCanvas: (props: any) => mockCanvas(props), PuppetBoundary: ({ children }: any) => children,
}));
void [RN.View, RN.Text, RN.Pressable, RN.Image];
let root: Root, reduced = false;
let appChange: (state: string) => void;
let reduceChange: (value: boolean) => void;
const layers = () => ({ plate: {}, head: {}, lids: [], dispose: jest.fn() });
let owned: ReturnType<typeof layers>;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers(); jest.clearAllMocks();
    mockFocused = true; reduced = false; owned = layers();
    mockRead.mockReset().mockResolvedValue(new Uint8Array([1]));
    mockPrepare.mockReset().mockResolvedValue(owned);
    mockValidate.mockReset();
    jest.spyOn(RN.AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(async () => reduced);
    jest.spyOn(RN.AccessibilityInfo, 'addEventListener').mockImplementation((_event, listener) => { reduceChange = listener; return { remove: jest.fn() }; });
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation((_event, listener: any) => { appChange = listener; return { remove: jest.fn() }; });
    RN.AppState.currentState = 'active';
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });
async function render(id = 'pip-parcel') {
    await act(async () => root.render(<OddlingPortrait id={id} name="Pip" />));
    const frame = root.container.queryAll(node => !!node.props.onLayout)[0];
    await act(async () => frame.props.onLayout({ nativeEvent: { layout: { width: 360, height: 540 } } }));
}
async function advance() { await act(async () => { await jest.advanceTimersByTimeAsync(100); }); }
const still = () => root.container.queryAll(node => node.props.contentFit === 'cover');
const text = (value: string) => root.container.queryAll(node => node.children.includes(value));
async function toggle() {
    const button = root.container.queryAll(node => node.props.accessibilityRole === 'button')[0];
    await act(async () => button.props.onClick({ nativeEvent: {}, target: 1, currentTarget: 1 }));
}
const playing = () => (mockCanvas.mock.calls.at(-1) as any)?.[0]?.playing;

test('reduced motion waits for Play; blur/background/pause stop movement and keep the still', async () => {
    reduced = true;
    await render(); await advance();
    expect(still()).toHaveLength(1); expect(mockRead).not.toHaveBeenCalled();
    await toggle(); expect(text(t('oddlings.puppet.preparing'))).toHaveLength(1);
    await advance(); expect(playing()).toBe(true);
    mockFocused = false; await render(); expect(playing()).toBe(false);
    mockFocused = true; await render(); expect(playing()).toBe(true);
    await act(async () => appChange('background')); expect(playing()).toBe(false);
    await act(async () => appChange('active')); expect(playing()).toBe(true);
    await toggle(); expect(playing()).toBe(false); expect(still()).toHaveLength(1);
    await act(async () => reduceChange(false)); expect(playing()).toBe(false);
});

test.each(['decode', 'shader', 'invalid'])('%s failure keeps the still and reports failed', async failure => {
    if (failure === 'invalid') mockRead.mockResolvedValue(null);
    else mockPrepare.mockRejectedValue(new Error(failure));
    await render(); await advance();
    expect(still()).toHaveLength(1); expect(text(t('oddlings.puppet.failed')).length).toBeGreaterThan(0);
    expect(mockCanvas).not.toHaveBeenCalled();
});

test('download failure reports offline and retry uses the same download path', async () => {
    mockRead.mockRejectedValueOnce(new Error('offline'));
    await render(); await advance();
    expect(text(t('oddlings.puppet.offline')).length).toBeGreaterThan(0); expect(still()).toHaveLength(1);
    await toggle(); await advance(); expect(mockRead).toHaveBeenCalledTimes(2);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
});

test('changing character aborts pending work and disposes a late result', async () => {
    let resolve!: (value: any) => void;
    mockPrepare.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    await render(); await advance();
    const signal = mockPrepare.mock.calls[0][3] as AbortSignal;
    await render('mira-measure'); expect(signal.aborted).toBe(true);
    const stale = layers(); await act(async () => resolve(stale));
    expect(stale.dispose).toHaveBeenCalledTimes(1);
    await advance(); expect(still()).toHaveLength(1);
});

test('unmount releases prepared images and cancels a queued preparation', async () => {
    await render(); await advance();
    await act(async () => root.unmount()); expect(owned.dispose).toHaveBeenCalledTimes(1);
    root = createRoot(); mockRead.mockClear(); await render();
    await act(async () => root.unmount()); await advance(); expect(mockRead).not.toHaveBeenCalled();
});

test('enabling reduced motion during autoplay releases layers and requires a new request', async () => {
    await render(); await advance(); expect(playing()).toBe(true);
    await act(async () => reduceChange(true));
    expect(owned.dispose).toHaveBeenCalledTimes(1); expect(still()).toHaveLength(1);
    mockPrepare.mockResolvedValue(layers());
    await toggle(); await advance(); expect(playing()).toBe(true); expect(mockPrepare).toHaveBeenCalledTimes(2);
});

test('binding is checked before ready; failure keeps the still and releases layers', async () => {
    mockValidate.mockImplementation(() => { throw new Error('puppet_shader_binding_failed'); });
    await render(); await advance();
    expect(mockValidate).toHaveBeenCalledTimes(1);
    expect(mockCanvas).not.toHaveBeenCalled();
    expect(text(t('oddlings.puppet.failed')).length).toBeGreaterThan(0);
    expect(still()).toHaveLength(1); expect(owned.dispose).toHaveBeenCalledTimes(1);
});
