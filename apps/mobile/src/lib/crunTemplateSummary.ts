import { API_BASE } from './api';

export interface CrunTemplateSummary {
    readonly total: number;
    readonly providers: Readonly<Record<string, number>>;
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
