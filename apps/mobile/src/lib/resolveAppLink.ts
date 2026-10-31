import { mapAppLink } from './appLinks';
import { fetchCatalog } from './media';
import { fetchPresets, presetHref } from './presets';

let generation = 0;
// The newest link's plain route: a superseded lookup returns this, never an older screen.
let latestMapped = '/create';
export function resolveAppLink(path: string): string | Promise<string> {
    const version = ++generation;
    const mapped = mapAppLink(path);
    latestMapped = mapped;
    let url: URL;
    try { url = new URL(path); } catch { return mapped; }
    if (url.protocol !== 'https:' || !['veyrnox.ai', 'www.veyrnox.ai'].includes(url.hostname) || url.pathname !== '/app/create') return mapped;
    const preset = url.searchParams.get('preset'), model = url.searchParams.get('model');
    if (mapped === '/create' || (!preset && !model)) return mapped;
    const current = () => version === generation;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<string>(resolve => { timer = setTimeout(() => resolve(current() ? mapped : latestMapped), 1500); });
    const lookup = (async () => {
        try {
            if (preset) {
                const found = (await fetchPresets()).find(p => p.id === preset);
                if (!current()) return latestMapped;
                if (!found) return '/create';
                const href = presetHref(found);
                const params: Record<string, string> = Object.fromEntries(Object.entries(href.params).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
                const recipe = url.searchParams.get('recipe');
                if (recipe && /^[A-Za-z0-9._-]{1,80}$/.test(recipe)) params.recipe = recipe;
                let pathname: string = href.pathname;
                for (const key of ['modelId', 'id']) if (pathname.includes(`[${key}]`)) { pathname = pathname.replace(`[${key}]`, encodeURIComponent(params[key])); delete params[key]; }
                return `${pathname}?${new URLSearchParams(params)}`;
            }
            const catalog = await fetchCatalog();
            if (!current()) return latestMapped;
            return catalog.some(m => m.id === model && !m.gated) ? mapped : '/create';
        } catch { return current() ? mapped : latestMapped; }
    })();
    return Promise.race([lookup, timeout]).finally(() => clearTimeout(timer));
}
