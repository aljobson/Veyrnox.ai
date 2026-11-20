import { requireOptionalNativeModule } from 'expo';
import type { VisionTransport } from './protocol';
export interface NativeVisionModule {
    init(): Promise<void>;
    detect(token: string, op: string, jpeg: string, width: number, height: number): Promise<Record<string, unknown>>;
    cancel(token: string): void;
    addListener(event: 'admitted', listener: (event: { token: string }) => void): { remove(): void };
}
let sequence = 0;
function optionalModule(): NativeVisionModule | null {
    try { return requireOptionalNativeModule<NativeVisionModule>('VeyrnoxVision'); } catch { return null; }
}
// Each mounted owner has its own transport. The native module serializes work across owners.
export function createNativeVisionTransport(receive: (message: string) => void, native = optionalModule()): VisionTransport {
    let closed = false, token: string | undefined, requestId = 0;
    let admission: ((id: number) => void) | undefined;
    const subscription = native?.addListener('admitted', event => {
        if (!closed && event.token === token) admission?.(requestId);
    });
    const deliver = (id: number, value: Record<string, unknown>) => { if (!closed) receive(JSON.stringify({ ...value, id })); };
    return {
        onAdmitted(listener) { admission = listener; },
        send(message) {
            if (closed || !native) throw Error('inference-unavailable');
            const request = JSON.parse(message);
            requestId = request.id;
            if (request.op === 'init') {
                void native.init().then(() => deliver(request.id, { ready: true }), () => deliver(request.id, { error: true }));
                return;
            }
            const mine = token = `${Date.now()}-${++sequence}`;
            void native.detect(mine, request.op, request.jpeg, request.width, request.height).then(result => {
                if (closed || token !== mine) return;
                token = undefined;
                deliver(request.id, { ...result, sourceId: request.sourceId, frameId: request.frameId });
            }, () => { if (token === mine) deliver(request.id, { error: true }); });
        },
        close() {
            if (closed) return;
            closed = true; subscription?.remove();
            if (token) { try { native?.cancel(token); } catch { /* Old binary or bridge teardown. */ } }
            token = undefined; admission = undefined;
        },
    };
}
