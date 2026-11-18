import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { API_BASE } from '../api';
import { TEMPLATE_SWAP_RUNTIME } from './runtimeFlag';
import type { SwapOffer } from '../../../../../app/veyrnox/_lib/templateSwapClient.mjs';
export type { SwapOffer };
type Answer = { kind: 'offer'; offer: SwapOffer } | { kind: 'absent' | 'transient' };
const listeners = new Set<(id: string) => void>();
export const refreshSwapOffer = (id: string) => listeners.forEach(fn => fn(id));
export async function fetchSwapAvailability(id: string, options: { enabled?: boolean; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<Answer> {
    if (!(options.enabled ?? TEMPLATE_SWAP_RUNTIME) || !id) return { kind: 'absent' };
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    // Manual deadline also bounds a transport/JSON reader that ignores its signal.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<Answer>(resolve => { timer = setTimeout(() => { abort(); resolve({ kind: 'transient' }); }, 4000); });
    const read = async (): Promise<Answer> => {
        try {
            const response = await (options.fetcher ?? fetch)(`${API_BASE}/api/catalog?template_swap=${encodeURIComponent(id)}`, { cache: 'no-store', signal: controller.signal });
            if (response.status === 404) return { kind: 'absent' };
            if (response.status !== 200) return { kind: 'transient' };
            const c = await response.json();
            if (c?.id !== id || c.model !== 'kling-o1-reference' || !Number.isInteger(c.credits) || c.credits <= 0 || c.durationSeconds !== 5 || c.images !== 2 || typeof c.role !== 'string' || !c.role.trim()) return { kind: 'transient' };
            return { kind: 'offer', offer: c };
        } catch { return { kind: 'transient' }; }
    };
    try { return await Promise.race([read(), deadline]); }
    finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export function nextOffer(previous: SwapOffer | null, id: string, answer: Answer): SwapOffer | null {
    return answer.kind === 'offer' ? answer.offer : answer.kind === 'absent' ? null : previous?.id === id ? previous : null;
}
export function useSwapAvailability(id: string | undefined) {
    const [offer, setOffer] = useState<SwapOffer | null>(null);
    useFocusEffect(useCallback(() => {
        let controller: AbortController | undefined;
        const check = () => {
            controller?.abort(); controller = new AbortController(); const signal = controller.signal;
            void fetchSwapAvailability(id ?? '', { signal }).then(answer => { if (!signal.aborted) setOffer(previous => nextOffer(previous, id ?? '', answer)); });
        };
        const refresh = (changed: string) => { if (changed === id) check(); };
        check(); listeners.add(refresh);
        return () => { controller?.abort(); listeners.delete(refresh); };
    }, [id]));
    return TEMPLATE_SWAP_RUNTIME && offer?.id === id ? offer : null;
}
export function useSwapRedirect(templateId?: string) {
    // The preset, template and template_id query params all name the template the way deep links carry it.
    const params = useLocalSearchParams<{ preset?: string; template?: string; template_id?: string }>();
    const offer = useSwapAvailability(templateId || params.preset || params.template || params.template_id), router = useRouter();
    useEffect(() => { if (offer) router.replace({ pathname: '/templates/[id]', params: { id: offer.id } }); }, [offer, router]);
}
