import { act } from 'react';
import { createRoot } from 'test-renderer';
import { AppState, type AppStateStatus } from 'react-native';
import { ApiError } from '../../src/lib/api';
import { ReceiptRequest } from '../../src/lib/beatAi/request';
import { useBeatAiRequest } from '../../src/lib/beatAi/useBeatAiRequest';
import { pendingStore } from '../../src/lib/beatAi/pending';
import { markOffline, markOnline, resetNetworkState } from '../../src/lib/networkState';
import type { Pending } from '../../src/lib/beatAi/types';
import { client, files, owner, beatId, row, id } from './fixtures';
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000042' }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
let changeState: (state: AppStateStatus) => void;
const previousState = AppState.currentState;
function Harness({ flow }: { flow: ReceiptRequest<Pending> }) { useBeatAiRequest(flow); return null; }
beforeEach(() => {
    jest.useFakeTimers(); resetNetworkState(); AppState.currentState = 'active'; root = createRoot();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
        changeState = listener; return { remove: jest.fn() };
    });
});
afterEach(async () => {
    await act(async () => root.unmount()); jest.restoreAllMocks(); jest.useRealTimers();
    AppState.currentState = previousState; resetNetworkState();
});
async function setup() {
    const c = client(), storage = pendingStore(files().port), accepted = { ...row(), requestId: id(8) };
    const flow = new ReceiptRequest<Pending>({ owner, beatId, client: c.client, storage, current: () => true,
        off: jest.fn(), finish: async () => ({ message: 'beatAi.failed' }) });
    await storage.put(accepted); c.request.mockResolvedValue({ state: 'running' });
    await act(async () => root.render(<Harness flow={flow} />));
    await act(async () => { await flow.resume(accepted); }); c.request.mockClear();
    return { ...c, flow, storage };
}
const tick = async (ms = 1500) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
test.each([0, 502])('polling recovers from status %s, including the offline network signal', async status => {
    const x = await setup();
    x.request.mockImplementationOnce(async () => { if (status === 0) markOffline(); throw new ApiError(status, 'temporary'); });
    await tick(); expect(x.flow.snapshot().error).not.toBe(''); expect(x.request).toHaveBeenCalledTimes(1);
    await tick(); expect(x.request).toHaveBeenCalledTimes(2); expect(x.flow.snapshot().error).toBe('');
    expect(await x.storage.read(owner, beatId)).toHaveLength(1);
});
test('429 waits out Retry-After before polling again, including manual checks', async () => {
    const x = await setup(); x.request.mockRejectedValueOnce(new ApiError(429, 'rate_limited', { retryAfterSeconds: 5 }));
    await tick(); expect(x.flow.snapshot().errorParams).toEqual({ n: 5 });
    await act(async () => { await x.flow.check(); await x.flow.resume(x.flow.snapshot().record!); }); await tick(4500);
    expect(x.request).toHaveBeenCalledTimes(1);
    await tick(); expect(x.request).toHaveBeenCalledTimes(2); expect(x.flow.snapshot().error).toBe('');
});
test('foreground and reconnect clear the previous error; background pauses polling', async () => {
    const x = await setup(); x.request.mockRejectedValue(new ApiError(502, 'temporary'));
    await tick(); expect(x.flow.snapshot().error).not.toBe('');
    await act(async () => changeState('background')); await tick(4500); expect(x.request).toHaveBeenCalledTimes(1);
    await act(async () => changeState('active')); expect(x.flow.snapshot().error).toBe('');
    await tick(); expect(x.flow.snapshot().error).not.toBe('');
    await act(async () => markOffline()); await act(async () => markOnline()); expect(x.flow.snapshot().error).toBe('');
});
test('a definitive poll refusal stops the timer', async () => {
    const x = await setup(); x.request.mockRejectedValue(new ApiError(400, 'prompt_invalid'));
    await tick(); expect(x.flow.snapshot().pollRefused).toBe(true);
    await tick(6000); expect(x.request).toHaveBeenCalledTimes(1);
});
test('terminal status stops polling and retires after finish', async () => {
    const x = await setup(); x.request.mockResolvedValue({ state: 'refunded' });
    await tick(); expect(x.flow.snapshot().terminal).toBe(true); expect(await x.storage.read(owner, beatId)).toEqual([]);
    await tick(6000); expect(x.request).toHaveBeenCalledTimes(1);
});
