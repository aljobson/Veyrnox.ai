import { API_BASE } from './api';

export interface CrunTemplateSummary {
    readonly total: number;
    readonly providers: Readonly<Record<string, number>>;
}

export const CRUN_TEMPLATE_PROVIDERS = ['kling', 'seedance', 'vidu'] as const;
export type CrunTemplateProvider = typeof CRUN_TEMPLATE_PROVIDERS[number];
export const CRUN_TEMPLATE_PROVIDER_NAMES: Readonly<Record<CrunTemplateProvider, string>> = {
    kling: 'Kling',
    seedance: 'Seedance',
    vidu: 'Vidu',
};

export interface CrunTemplatePreview {
    readonly catalogId: string;
    readonly id: string;
    readonly providerTemplateId: string;
    readonly name: string;
    readonly category: string;
    readonly tag: string | null;
    readonly coverUrl: string | null;
    readonly previewUrl: string | null;
    readonly previewKind: 'image' | 'video' | null;
    readonly inputCount: number | null;
    readonly inputRequirement: string | null;
    readonly providerCredits: number | null;
    readonly credits: number | null;
    readonly minInputCount: number;
    readonly maxInputCount: number;
    readonly requirements: readonly { readonly label: string; readonly value: string }[];
    readonly prices: readonly { readonly resolution: string; readonly credits: number }[];
}

export interface CrunTemplateCatalog {
    readonly provider: CrunTemplateProvider;
    readonly total: number;
    readonly page: number;
    readonly pageSize: number;
    readonly templates: readonly CrunTemplatePreview[];
}

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const nonNegative = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const httpsUrl = (value: unknown): string | null => {
    const raw = text(value);
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' ? url.toString() : null;
    } catch { return null; }
};

export function parseCrunTemplateCatalog(body: unknown): CrunTemplateCatalog | null {
    const value = body as Record<string, unknown> | null;
    const provider = text(value?.provider);
    const total = nonNegative(value?.total), page = nonNegative(value?.page), pageSize = nonNegative(value?.pageSize);
    if (!CRUN_TEMPLATE_PROVIDERS.includes(provider as CrunTemplateProvider) || total === null || !Number.isInteger(total)
        || page === null || !Number.isInteger(page) || page < 1 || pageSize === null || !Number.isInteger(pageSize) || pageSize < 1
        || !Array.isArray(value?.templates)) return null;
    const templates = value.templates.flatMap((raw): CrunTemplatePreview[] => {
        const item = raw as Record<string, unknown> | null;
        const catalogId = text(item?.catalogId), id = text(item?.id), providerTemplateId = text(item?.providerTemplateId), name = text(item?.name);
        if (!catalogId || !id || !providerTemplateId || !name) return [];
        const previewKind = item?.previewKind === 'image' || item?.previewKind === 'video' ? item.previewKind : null;
        return [{
            catalogId,
            id,
            providerTemplateId,
            name,
            category: text(item?.category) ?? '',
            tag: text(item?.tag),
            coverUrl: httpsUrl(item?.coverUrl),
            previewUrl: httpsUrl(item?.previewUrl),
            previewKind,
            inputCount: Number.isInteger(item?.inputCount) && (item?.inputCount as number) > 0 ? item?.inputCount as number : null,
            inputRequirement: text(item?.inputRequirement),
            providerCredits: nonNegative(item?.providerCredits),
            credits: nonNegative(item?.credits),
            minInputCount: Number.isInteger(item?.minInputCount) && (item?.minInputCount as number) >= 0 ? item?.minInputCount as number : 1,
            maxInputCount: Number.isInteger(item?.maxInputCount) && (item?.maxInputCount as number) >= 0 ? item?.maxInputCount as number : 1,
            requirements: Array.isArray(item?.requirements) ? item.requirements.flatMap((raw): { label: string; value: string }[] => {
                const requirement = raw as Record<string, unknown>; const label = text(requirement.label), value = text(requirement.value);
                return label && value ? [{ label, value }] : [];
            }).slice(0, 12) : [],
            prices: Array.isArray(item?.prices) ? item.prices.flatMap((raw): { resolution: string; credits: number }[] => {
                const price = raw as Record<string, unknown>; const resolution = text(price.resolution), credits = nonNegative(price.credits);
                return resolution && credits !== null && Number.isInteger(credits) ? [{ resolution, credits }] : [];
            }) : [],
        }];
    });
    return { provider: provider as CrunTemplateProvider, total, page, pageSize, templates };
}

export function parseCrunTemplateSummary(body: unknown): CrunTemplateSummary | null {
    const value = body as { total?: unknown; providers?: unknown } | null;
    if (!Number.isInteger(value?.total) || (value?.total as number) < 0 || !value?.providers || typeof value.providers !== 'object' || Array.isArray(value.providers)) return null;
    const providers = Object.fromEntries(Object.entries(value.providers).filter(([, count]) => Number.isInteger(count) && (count as number) >= 0)) as Record<string, number>;
    if (!['kling', 'seedance', 'vidu'].every(provider => Number.isInteger(providers[provider]))) return null;
    if (providers.kling + providers.seedance + providers.vidu !== value.total) return null;
    return { total: value.total as number, providers };
}

export async function fetchCrunTemplateSummary(): Promise<CrunTemplateSummary> {
    const response = await fetch(`${API_BASE}/api/template-catalog?summary=1`);
    if (!response.ok) throw new Error('crun_template_summary_unavailable');
    const summary = parseCrunTemplateSummary(await response.json());
    if (!summary) throw new Error('crun_template_summary_invalid');
    return summary;
}

export async function fetchCrunTemplateCatalog(provider: CrunTemplateProvider, page = 1): Promise<CrunTemplateCatalog> {
    const response = await fetch(`${API_BASE}/api/template-catalog?provider=${encodeURIComponent(provider)}&page=${page}&page_size=50`);
    if (!response.ok) throw new Error('crun_template_catalog_unavailable');
    const catalog = parseCrunTemplateCatalog(await response.json());
    if (!catalog || catalog.provider !== provider || catalog.page !== page) throw new Error('crun_template_catalog_invalid');
    return catalog;
}
