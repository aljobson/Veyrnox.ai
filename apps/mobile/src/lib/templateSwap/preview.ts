import { useEffect, useState } from 'react';
import { API_BASE } from '../api';
// The swap screen's thumbnail: the template's own poster, read from the anonymous GET /api/templates/:id (clip.poster).
// Never a hardcoded address; the server path is joined to the API origin and anything else is refused.
export interface SwapPreview { readonly title: string; readonly posterUrl: string; readonly ratio: number }
const PATH_RE = /^\/(?!\/)[A-Za-z0-9/_.-]+$/, ID_RE = /^[a-z0-9-]{1,40}$/;
export function parseSwapPreview(body: unknown, base: string = API_BASE): SwapPreview | null {
    const template = (body as { template?: { name?: unknown; clip?: { poster?: unknown; aspectRatio?: unknown } | null } } | null)?.template;
    const poster = template?.clip?.poster;
    if (typeof poster !== 'string' || !PATH_RE.test(poster)) return null;
    const match = typeof template?.clip?.aspectRatio === 'string' ? /^\s*(\d{1,5})\s*[/:]\s*(\d{1,5})\s*$/.exec(template.clip.aspectRatio) : null;
    const raw = match && Number(match[2]) > 0 ? Number(match[1]) / Number(match[2]) : 9 / 16;
    return { title: typeof template?.name === 'string' ? template.name : '', posterUrl: `${base}${poster}`, ratio: Math.min(16 / 9, Math.max(9 / 16, raw)) };
}
export async function fetchSwapPreview(id: string, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<SwapPreview | null> {
    if (!ID_RE.test(id)) return null;
    try {
        const response = await fetcher(`${API_BASE}/api/templates/${encodeURIComponent(id)}`, { signal });
        return response.ok ? parseSwapPreview(await response.json()) : null;
    } catch { return null; }
}
/** undefined while loading, null when the template has no poster. */
export function useSwapPreview(id: string | undefined): SwapPreview | null | undefined {
    const [state, setState] = useState<{ id?: string; preview: SwapPreview | null }>({ preview: null });
    useEffect(() => {
        if (!id) return;
        const controller = new AbortController();
        void fetchSwapPreview(id, fetch, controller.signal).then(preview => { if (!controller.signal.aborted) setState({ id, preview }); });
        return () => controller.abort();
    }, [id]);
    return state.id === id ? state.preview : undefined;
}
