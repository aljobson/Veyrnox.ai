import { kindOf, type CatalogModel } from './media';
import { CREATIVE_FEATURES } from './creativeFeatures';

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

// Only screens a signed-in person can open. Titles are looked up by the caller so they follow the language.
export const SCREENS: readonly ScreenDef[] = [
    { id: 'explore', titleKey: 'srch.s.explore', href: '/', keywords: 'home templates start' },
    { id: 'create', titleKey: 'srch.s.create', href: '/create', keywords: 'generate image video audio make' },
    { id: 'tools', titleKey: 'srch.s.tools', href: '/create/tools', keywords: 'upscale remove background face filters edit photo video' },
    { id: 'face-filters', titleKey: 'srch.s.faceFilters', href: '/face-filters', keywords: 'age style relight expression face photo' },
    { id: 'film', titleKey: 'srch.s.film', href: '/film', keywords: 'studio shots script references assets prompts movie' },
    { id: 'mcp', titleKey: 'srch.s.mcp', href: '/mcp', keywords: 'connector assistant oauth endpoint integrations' },
    { id: 'oddlings', titleKey: 'srch.s.oddlings', href: '/oddlings', keywords: 'characters creator mascot animate' },
    { id: 'templates', titleKey: 'srch.s.templates', href: '/create/presets', keywords: 'presets gallery' },
    { id: 'library', titleKey: 'srch.s.library', href: '/library', keywords: 'creations files downloads saved' },
    { id: 'chat', titleKey: 'srch.s.chat', href: '/chat', keywords: 'vey assistant talk' },
    { id: 'cinema', titleKey: 'srch.s.cinema', href: '/cinema', keywords: 'watch films vote' },
    { id: 'publish', titleKey: 'srch.s.publish', href: '/publish', keywords: 'post schedule social calendar' },
    { id: 'projects', titleKey: 'srch.s.projects', href: '/projects', keywords: 'edit saved' },
    { id: 'edit', titleKey: 'srch.s.edit', href: '/edit', keywords: 'trim join captions clip' },
    { id: 'credits', titleKey: 'srch.s.credits', href: '/credits', keywords: 'balance buy top up packs' },
    { id: 'history', titleKey: 'srch.s.history', href: '/history', keywords: 'ledger charges refunds' },
    { id: 'referrals', titleKey: 'srch.s.referrals', href: '/referrals', keywords: 'invite friends code' },
    { id: 'models', titleKey: 'srch.s.models', href: '/models', keywords: 'catalogue catalog list' },
    { id: 'pricing', titleKey: 'srch.s.pricing', href: '/pricing', keywords: 'cost price credits' },
    { id: 'brand', titleKey: 'srch.s.brand', href: '/brand-kit', keywords: 'colours colors fonts palette' },
    { id: 'account', titleKey: 'srch.s.account', href: '/account', keywords: 'profile email settings' },
    { id: 'security', titleKey: 'srch.s.security', href: '/security', keywords: 'password two-factor 2fa devices assistants sessions' },
    { id: 'blocked', titleKey: 'srch.s.blocked', href: '/blocked', keywords: 'mute members' },
    { id: 'appeals', titleKey: 'srch.s.appeals', href: '/appeals', keywords: 'content decisions' },
    { id: 'report', titleKey: 'srch.s.report', href: '/report', keywords: 'problem abuse flag' },
    { id: 'help', titleKey: 'srch.s.help', href: '/help', keywords: 'support contact question' },
    { id: 'about', titleKey: 'srch.s.about', href: '/about', keywords: 'company legal terms privacy' },
];

export function screenEntries(title: (key: string) => string): SearchEntry[] {
    return [
        ...SCREENS.map((s) => ({ id: `screen:${s.id}`, kind: 'screen' as const, title: title(s.titleKey), detail: '', href: s.href, keywords: s.keywords })),
        ...CREATIVE_FEATURES.map((feature) => ({
            id: `feature:${feature.slug}`,
            kind: 'screen' as const,
            title: feature.title,
            detail: feature.group,
            href: `/features/${feature.slug}`,
            keywords: `${feature.group} ${feature.kind} ${feature.media.join(' ')} ${feature.steps.join(' ')}`.toLowerCase(),
        })),
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
