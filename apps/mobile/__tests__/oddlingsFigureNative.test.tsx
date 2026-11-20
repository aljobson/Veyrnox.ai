import { act, StrictMode } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { OddlingFigure } from '../src/components/oddlings/OddlingFigure';
import { svgForPicks } from '../src/lib/oddlingsFigure';
import { ODDLINGS } from '../src/lib/oddlings';
import type { Picks } from '../src/lib/oddlingsBuilder';

const mockFactory = jest.fn();
const mockDraw = jest.fn((_props: any) => null);
jest.mock('@shopify/react-native-skia', () => ({
    Skia: { SVG: { MakeFromString: (text: string) => mockFactory(text) } },
    Canvas: ({ children }: any) => children,
    ImageSVG: (props: any) => mockDraw(props),
}));
void RN.View;
const fixtures: Picks[] = [{}, { hair: 'Braids', neck: 'Feather Halo', skin: 'Porcelain' }, ...ODDLINGS.slice(0, 4).map(o => o.picks as Picks)];
let root: Root;
const handles: { disposed: boolean; dispose: jest.Mock }[] = [];
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    handles.length = 0; jest.clearAllMocks();
    mockFactory.mockReset().mockImplementation(() => {
        const handle = { disposed: false, dispose: jest.fn(() => { handle.disposed = true; }) };
        handles.push(handle); return handle;
    });
    mockDraw.mockImplementation(({ svg }) => { expect(svg.disposed).toBe(false); return null; });
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });
async function render(picks: Picks, focus = 'body') {
    await act(async () => root.render(<StrictMode><OddlingFigure picks={picks} focus={focus} /></StrictMode>));
    const box = root.container.queryAll(node => !!node.props.onLayout)[0];
    await act(async () => box.props.onLayout({ nativeEvent: { layout: { width: 360, height: 280 } } }));
}

test('representative SVGs use the CanvasKit factory when supported; headless limitation is explicit', async () => {
    const kit = await require('canvaskit-wasm/bin/full/canvaskit')({});
    const { Skia } = require('@shopify/react-native-skia/lib/commonjs/mock').Mock(kit);
    const svgs = fixtures.map(picks => svgForPicks(picks));
    expect(svgs.join('')).toMatch(/transform="rotate\(/);
    expect(svgs.join('')).toContain('stroke-dasharray=');
    expect(svgs.join('')).toContain('stroke-linecap=');
    try {
        for (const svg of svgs) {
            const parsed = Skia.SVG.MakeFromString(svg);
            expect(parsed).not.toBeNull();
            parsed?.dispose();
        }
    } catch (error) {
        // This Skia web adapter creates an HTMLImageElement, not a CanvasKit SVG DOM.
        // Do not pretend that stubbing browser APIs verifies native SVG parsing.
        if (!(error instanceof ReferenceError) || !/DOMParser|Image|document/.test(error.message)) throw error;
        process.stdout.write(`CanvasKit SVG unavailable in headless Jest: ${error.message}; factory/lifetime path tested with stub.\n`);
        expect(typeof (globalThis as any).DOMParser).toBe('undefined');
    }
});

test('factory receives representative markup; StrictMode, prop changes and unmount release each handle once', async () => {
    await render(fixtures[0]);
    expect(mockFactory.mock.calls.length).toBeGreaterThanOrEqual(2); // effect setup/cleanup/setup
    expect(handles[0].dispose).toHaveBeenCalledTimes(1);
    expect(handles.at(-1)?.disposed).toBe(false);
    for (const picks of fixtures.slice(1)) {
        await render(picks, 'face');
        expect(mockFactory).toHaveBeenLastCalledWith(svgForPicks(picks, 'face'));
        expect(mockDraw).toHaveBeenLastCalledWith(expect.objectContaining({ svg: handles.at(-1), width: 360, height: 280 }));
    }
    await act(async () => root.unmount());
    handles.forEach(handle => expect(handle.dispose).toHaveBeenCalledTimes(1));
});

test.each(['null', 'throw'])('SVG factory %s leaves the accessible background without drawing', async result => {
    mockFactory.mockImplementation(() => { if (result === 'throw') throw new Error('SVG failed'); return null; });
    await render(fixtures[1]);
    expect(mockDraw).not.toHaveBeenCalled();
    expect(root.container.queryAll(node => node.props.accessibilityRole === 'image' && node.props.pointerEvents === 'none')).toHaveLength(1);
});
