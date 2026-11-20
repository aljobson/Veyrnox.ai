import type { Frame } from '../liveEdit/protocol';
import type { SwapInference } from '../liveEdit/swapProtocol';
type Pending = { key: number; frame: Frame; resolve(value: SwapInference): void; reject(error: Error): void };
let pending: Pending | null = null, sequence = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(fn => fn());
export const detection = {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    snapshot: () => pending,
    detect(frame: Frame, signal: AbortSignal): Promise<SwapInference> {
        if (pending) return Promise.reject(Error('cutout_failed'));
        if (signal.aborted) return Promise.reject(Error('cancelled'));
        return new Promise((resolve, reject) => {
            const key = ++sequence;
            const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (pending?.key === key) { pending = null; emit(); } };
            const abort = () => { finish(); reject(Error('cancelled')); };
            const timer = setTimeout(() => { finish(); reject(Error('cutout_failed')); }, 135_000);
            pending = { key, frame, resolve: value => { finish(); resolve(value); }, reject: error => { finish(); reject(error); } };
            signal.addEventListener('abort', abort, { once: true }); emit();
        });
    },
};
