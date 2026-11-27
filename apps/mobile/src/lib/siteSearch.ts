import { kindOf, type CatalogModel } from './media';
import { FILM_STUDIO_ENABLED } from './filmStudioSwitch';
import { CREATIVE_FEATURES, creativeFeatureOwner } from './creativeFeatures';
import { MOBILE_FEATURES, searchableFeatures } from './featureRegistry';

// Search over the app's own screens and the model catalogue (parity P7, the web's site search). It works on the
// phone: nothing is sent anywhere, and the models come from the catalogue the app already loads.
export interface SearchEntry {
    readonly id: string;
    readonly kind: 'screen' | 'model';
    readonly title: string;
    readonly detail: string;
    readonly href: string;
    // Extra words that find this entry (synonyms), lower case.
    readonly keywords: string;
}

export interface ScreenDef {
    readonly id: string;
    readonly titleKey: string;
    readonly href: string;
    readonly keywords: string;
}

export interface SearchCapabilities {
    readonly musicAvailable: boolean;
}

// Only screens a signed-in person can open. Titles are looked up by the caller so they follow the language.
export const SCREENS: readonly ScreenDef[] = MOBILE_FEATURES.filter((feature) => feature.keywords && !feature.discoveryOwner).map((feature) => ({
    id: feature.id,
    titleKey: feature.titleKey,
    href: feature.href,
    keywords: feature.keywords as string,
}));

export function screenEntries(title: (key: string) => string, capabilities: SearchCapabilities = { musicAvailable: false }): SearchEntry[] {
    const audioFeatureWords = CREATIVE_FEATURES
        .filter((feature) => creativeFeatureOwner(feature) === 'audio')
        .map((feature) => `${feature.title} ${feature.group} ${feature.kind} ${feature.media.join(' ')} ${feature.steps.join(' ')}`)
        .join(' ')
        .toLowerCase();
    const audioAliases = MOBILE_FEATURES
        .filter((feature) => feature.discoveryOwner === 'audio')
        .map((feature) => `${title(feature.titleKey)} ${feature.keywords ?? ''}`)
        .join(' ')
        .toLowerCase();
    const registry = searchableFeatures({ filmStudio: FILM_STUDIO_ENABLED, musicAvailable: capabilities.musicAvailable }).map((s) => ({
        id: `screen:${s.id}`,
        kind: 'screen' as const,
        title: title(s.titleKey),
        detail: '',
        href: s.href,
        keywords: `${s.keywords as string}${s.id === 'audio' ? ` ${audioAliases} ${audioFeatureWords}` : ''}`,
    }));
    const registeredHrefs = new Set(registry.map((entry) => entry.href));
    return [
        ...registry,
        ...CREATIVE_FEATURES.filter((feature) => creativeFeatureOwner(feature) === 'creative').map((feature) => ({
            id: `feature:${feature.slug}`,
            kind: 'screen' as const,
            title: feature.title,
            detail: feature.group,
            href: `/features/${feature.slug}`,
            keywords: `${feature.group} ${feature.kind} ${feature.media.join(' ')} ${feature.steps.join(' ')}`.toLowerCase(),
        })).filter((entry) => !registeredHrefs.has(entry.href)),
    ];
}

export function modelEntries(models: readonly CatalogModel[]): SearchEntry[] {
    return models.map((m) => ({
        id: `model:${m.id}`,
        kind: 'model',
        title: m.name,
        detail: kindOf(m.modality) ?? m.modality,
        href: `/create/${encodeURIComponent(m.id)}`,
        keywords: m.modality.toLowerCase(),
    }));
}

const MAX_QUERY = 80;
export const MAX_RESULTS = 20;

const norm = (s: string): string => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

// Every word of the query must match: a title that starts with it ranks first, then a word that starts with it, then
// a title that contains it, then a keyword. An empty query finds nothing.
export function searchEntries(query: string, entries: readonly SearchEntry[]): SearchEntry[] {
    const words = norm(query.slice(0, MAX_QUERY)).split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const scored: { entry: SearchEntry; score: number; order: number }[] = [];
    entries.forEach((entry, order) => {
        const title = norm(entry.title);
        const titleWords = title.split(/[^a-z0-9]+/).filter(Boolean);
        const keys = norm(entry.keywords);
        let total = 0;
        for (const w of words) {
            let s = 0;
            if (title.startsWith(w)) s = 4;
            else if (titleWords.some((tw) => tw.startsWith(w))) s = 3;
            else if (title.includes(w)) s = 2;
            else if (keys.split(/\s+/).some((k) => k.startsWith(w))) s = 1;
            if (s === 0) return;
            total += s;
        }
        scored.push({ entry, score: total, order });
    });
    return scored.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, MAX_RESULTS).map((s) => s.entry);
}
