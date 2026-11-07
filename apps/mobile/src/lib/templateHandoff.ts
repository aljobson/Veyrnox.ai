import type { Preset } from './presets';

// What a template tells Create besides its words and length: its name, the picture it shows, the shape of its result and
// what it needs from the person. It travels in the route's parameters, so everything read back is checked: a link from
// outside the app can put anything there.
export interface TemplateInfo {
    readonly id: string | null;
    readonly title: string;
    readonly needs: string | null;
    readonly negativePrompt?: string;
    readonly sourceAspect: string | null;
    // Width over height of the template's own preview, when the server said.
    readonly ratio: number | null;
    readonly poster: string | null;
}

const TITLE_MAX = 80;
const NEEDS_MAX = 200;
const POSTER_MAX = 300;

// The feed writes it "406 / 720" or "9 / 16"; a model lists its own as "9:16".
export function parseRatio(raw: unknown): number | null {
    if (typeof raw !== 'string') return null;
    const m = /^\s*(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)\s*$/.exec(raw);
    if (!m) return null;
    const w = Number(m[1]);
    const h = Number(m[2]);
    return w > 0 && h > 0 ? w / h : null;
}

// The model's own aspect option closest to the template's shape, by how far apart they are as ratios. A list with
// nothing readable in it (or no ratio to match) gives null, and the caller keeps its usual default.
export function nearestAspect(ratio: number | null, aspects: readonly string[]): string | null {
    if (ratio === null) return null;
    let best: string | null = null;
    let bestGap = Infinity;
    for (const aspect of aspects) {
        const r = parseRatio(aspect);
        if (r === null) continue;
        const gap = Math.abs(Math.log(r / ratio));
        if (gap < bestGap) {
            best = aspect;
            bestGap = gap;
        }
    }
    return best;
}

export function templateParams(p: Pick<Preset, 'title' | 'needs' | 'posterUrl'> & { readonly sourceAspect?: string | null; readonly previewAspect?: string | null; readonly negativePrompt?: string }): Record<string, string> {
    const aspect = p.previewAspect || p.sourceAspect;
    return {
        tpl: p.title.slice(0, TITLE_MAX),
        ...(p.negativePrompt ? { tnegative: p.negativePrompt.trim().slice(0, 2000).trimEnd() } : {}),
        ...(p.needs ? { tneeds: p.needs.slice(0, NEEDS_MAX) } : {}),
        ...(p.sourceAspect && /^(?:1:1|9:16|16:9)$/.test(p.sourceAspect) ? { tsource: p.sourceAspect } : {}),
        ...(aspect ? { tratio: aspect } : {}),
        ...(p.posterUrl && p.posterUrl.length <= POSTER_MAX ? { tposter: p.posterUrl } : {}),
    };
}

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

// A picture only from a host we serve template posters from, over https: a crafted link must not make the app fetch
// an address of someone else's choosing.
export function isPosterUrl(url: string, hosts: readonly string[]): boolean {
    if (url.length > POSTER_MAX || !url.startsWith('https://')) return false;
    try {
        return hosts.includes(new URL(url).hostname);
    } catch {
        return false;
    }
}

export function readTemplate(params: Params, posterHosts: readonly string[]): TemplateInfo | null {
    const title = one(params.tpl);
    if (!title) return null;
    const needs = one(params.tneeds);
    const poster = one(params.tposter);
    return {
        id: typeof params.tid === 'string' && /^[a-z0-9-]{1,40}$/.test(params.tid) ? params.tid : null,
        title: title.slice(0, TITLE_MAX),
        negativePrompt: one(params.tnegative)?.trim().slice(0, 2000).trimEnd() || '',
        needs: needs ? needs.slice(0, NEEDS_MAX) : null,
        sourceAspect: typeof params.tsource === 'string' && /^(?:1:1|9:16|16:9)$/.test(params.tsource) ? params.tsource : null,
        ratio: parseRatio(params.tratio),
        poster: poster && isPosterUrl(poster, posterHosts) ? poster : null,
    };
}

// Origin is retained even when attribution is inactive, so switching back restores it.
export function normalizeTemplateCarry(carry: Readonly<Record<string, string>>, modelId: string): Record<string, string> {
    return { ...carry, ...((carry.tpl || carry.tid) ? { tmodel: carry.tmodel || modelId } : {}) };
}

// The template's name, picture and shape stay on screen on every model (QA-001/003). Only its server-side identity
// (the preset id sent with Generate) belongs to the model it was made for.
export function activeTemplate(params: Params, modelId: string, posterHosts: readonly string[]): TemplateInfo | null {
    return readTemplate(params, posterHosts);
}

// True while the form is on the model the template was made for.
export function templateOnOriginalModel(params: Params, modelId: string): boolean {
    return (one(params.tmodel) ?? modelId) === modelId;
}
