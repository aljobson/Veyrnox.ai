import { normalizeCloudError } from './cloud';
// Media errors must never be interpreted as project removal, rollout state or document limits.
export class TakeMediaError extends Error {
    readonly code: string;
    constructor(error: unknown) {
        super('Take preservation failed'); this.name = 'TakeMediaError';
        this.code = mediaError(error).code;
    }
}
const mediaError = (error: unknown) => {
    const value = normalizeCloudError(error) as { code?: string; status?: number } | null;
    return { code: String(value?.code ?? '').toUpperCase(), status: value?.status ?? 0 };
};
export function createMediaFailures() {
    const refused = new Set<string>(), retry = new Map<string, number>();
    return {
        retain(beatId: string, refs: string[]) {
            const keys = new Set(refs.flatMap(ref => [`${beatId}:upload:${ref}`, `${beatId}:download:${ref}`]));
            if (refs.length) { keys.add(`${beatId}:upload:list`); keys.add(`${beatId}:download:list`); }
            for (const key of [...refused, ...retry.keys()]) if (key.startsWith(`${beatId}:`) && !keys.has(key)) { refused.delete(key); retry.delete(key); }
        },
        held(key: string) { return refused.has(key) || (retry.get(key) ?? 0) > Date.now(); },
        ready(key: string) { refused.delete(key); retry.delete(key); },
        fail(key: string, error: unknown, strict = false) {
            if (strict) throw new TakeMediaError(error);
            const { code, status } = mediaError(error);
            const temporary = code === 'RATE_LIMITED' || (status === 409 && code === 'TAKE_UPLOAD_MISSING') ||
                [408, 425, 429].includes(status) || (!status && code === 'NETWORK_ERROR') || (status >= 500 && status < 600);
            if (!temporary || ['TAKE_CHANGED', 'LIMIT_REACHED', 'TAKE_UNAVAILABLE'].includes(code)) refused.add(key);
            else retry.set(key, Date.now() + 60_000);
        },
        defer(key: string) { retry.set(key, Date.now() + 60_000); },
        refuse(key: string) { refused.add(key); retry.delete(key); },
        nextRetryAt(beatId: string) {
            const times = [...retry].filter(([key]) => key.startsWith(`${beatId}:`) && !refused.has(key)).map(([, at]) => at);
            return times.length ? Math.min(...times) : 0;
        },
        reset() { refused.clear(); retry.clear(); },
    };
}
export const mediaCode = (error: unknown) => mediaError(error).code;
