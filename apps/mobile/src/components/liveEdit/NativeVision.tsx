import { useEffect, useLayoutEffect, useRef } from 'react';
import { createNativeVisionTransport } from '../../lib/liveEdit/nativeVision';
import { createVisionJob, type Frame, type Inference, type VisionTransport } from '../../lib/liveEdit/protocol';
type Job<T> = { init(): Promise<T | null>; detect(frame: Frame): Promise<T>; close(): void; receive(message: string): void };
type Props<T> = { frame: Frame; onResult(value: T): void; onError(): void; createJob: (transport: VisionTransport) => Job<T> };
export function NativeVision(props: Omit<Props<Inference>, 'createJob'>) { return <NativeVisionTransport {...props} createJob={createVisionJob} />; }
export function NativeVisionTransport<T>({ frame, onResult, onError, createJob }: Props<T>) {
    const callbacks = useRef({ onResult, onError });
    useLayoutEffect(() => { callbacks.current = { onResult, onError }; }, [onResult, onError]);
    useEffect(() => {
        let mounted = true;
        const transport = createNativeVisionTransport(message => job.receive(message));
        const job = createJob(transport);
        void (async () => {
            try {
                await job.init();
                const result = await job.detect(frame);
                if (mounted) callbacks.current.onResult(result);
            } catch { if (mounted) callbacks.current.onError(); }
            finally { job.close(); }
        })();
        return () => { mounted = false; job.close(); };
    }, [createJob, frame]);
    return null;
}
