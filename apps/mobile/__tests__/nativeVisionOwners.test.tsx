import { act } from 'react';
import { createRoot } from 'test-renderer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NativeVision } from '../src/components/liveEdit/NativeVision';
import { SwapVisionHost } from '../src/components/templates/SwapVisionHost';
import { detection } from '../src/lib/templateSwap/detection';
import { createInferenceLifecycle } from '../src/lib/liveEdit/lifecycle';
const mockCalls: { owner: string; token: string; op: string; resolve(value: object): void }[] = [];
const mockListeners = new Set<(event: { token: string }) => void>();
const mockCancel = jest.fn();
jest.mock('expo', () => ({ requireOptionalNativeModule: () => ({
    init: async () => {}, cancel: mockCancel,
    detect: (owner: string, token: string, op: string) => new Promise(resolve => { mockCalls.push({ owner, token, op, resolve }); }),
    addListener: (_: string, listener: (event: { token: string }) => void) => {
        mockListeners.add(listener); return { remove: () => mockListeners.delete(listener) };
    },
}) }));
const frame = { sourceId: 1, frameId: 1, width: 8, height: 8, jpeg: 'data:image/jpeg;base64,AAAA' };
const empty = { count: 0, landmarks: [], width: 8, height: 8, hair: null };
beforeEach(() => { mockCalls.length = 0; mockCancel.mockClear(); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; });
test('still-photo lifecycle unmounts on background, then remounts with fresh ownership', async () => {
    const root = createRoot(), result = jest.fn(), error = jest.fn(), lifecycle = createInferenceLifecycle();
    const render = (foreground: boolean) => root.render(foreground ? <NativeVision key={lifecycle.generation} frame={frame} onResult={result} onError={error} /> : <></>);
    try {
        await act(async () => render(true));
        expect(mockCalls[0].op).toBe('detect');
        expect(lifecycle.transition('background')).toBe('suspend'); await act(async () => render(false));
        expect(mockCancel).toHaveBeenCalledWith(mockCalls[0].owner, mockCalls[0].token);
        expect(lifecycle.transition('active')).toBe('refresh'); await act(async () => render(true));
        expect(mockCalls[1].owner).not.toBe(mockCalls[0].owner);
        await act(async () => mockCalls[0].resolve(empty)); expect(result).not.toHaveBeenCalled();
        await act(async () => { mockListeners.forEach(fn => fn({ token: mockCalls[1].token })); mockCalls[1].resolve(empty); });
        expect(result).toHaveBeenCalledTimes(1); expect(error).not.toHaveBeenCalled();
    } finally { await act(async () => root.unmount()); }
    expect(mockListeners.size).toBe(0);
    const source = readFileSync(resolve(__dirname, '../src/components/liveEdit/LiveEditScreen.tsx'), 'utf8');
    expect(source).toContain('source && foreground ? <NativeVision'); expect(source).not.toContain('VisionBridge');
});
test('account abort clears swap pending slot and cancels old token before replacement', async () => {
    const root = createRoot(), oldAccount = new AbortController(), newAccount = new AbortController();
    try {
        await act(async () => root.render(<SwapVisionHost />));
        let old!: Promise<unknown>;
        await act(async () => { old = detection.detect(frame, oldAccount.signal); });
        const cancelled = expect(old).rejects.toThrow('cancelled');
        await act(async () => oldAccount.abort()); await cancelled;
        expect(detection.snapshot()).toBeNull(); expect(mockCancel).toHaveBeenCalledWith(mockCalls[0].owner, mockCalls[0].token);
        let replacement!: Promise<unknown>;
        await act(async () => { replacement = detection.detect(frame, newAccount.signal); });
        expect(mockCalls[1].op).toBe('swapDetect');
        expect(mockCalls[1].owner).not.toBe(mockCalls[0].owner);
        await act(async () => mockCalls[0].resolve(empty)); expect(detection.snapshot()).not.toBeNull();
        await act(async () => { mockListeners.forEach(fn => fn({ token: mockCalls[1].token })); mockCalls[1].resolve({ count: 0, landmarks: [], width: 8, height: 8 }); });
        await expect(replacement).resolves.toMatchObject({ count: 0 }); expect(detection.snapshot()).toBeNull();
    } finally { await act(async () => root.unmount()); }
    expect(mockListeners.size).toBe(0);
});
