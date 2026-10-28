import { API_BASE } from './api';
import { categoriesOf } from './explore';
import { plural, t } from './i18n';
import type { Preset } from './presets';
import { parseRatio } from './templateHandoff';

export async function fetchPopularIds(): Promise<string[]> {
    try {
        const response = await fetch(`${API_BASE}/api/popular-templates`);
        if (!response.ok) return [];
        const body = await response.json();
        return Array.isArray(body.templates) ? body.templates.filter((id: unknown): id is string => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)).slice(0, 20) : [];
    } catch { return []; }
}
export function templateChips(presets: readonly Preset[], popularIds: readonly string[]): string[] {
    return ['ALL', ...(presets.some(p => p.isNew) ? ['NEW'] : []), ...(presets.some(p => popularIds.includes(p.id)) ? ['POPULAR'] : []), ...categoriesOf(presets).filter(c => c !== 'ALL')];
}
export function templatesFor(presets: readonly Preset[], chip: string, popularIds: readonly string[]): Preset[] {
    if (chip === 'POPULAR') return popularIds.flatMap(id => { const p = presets.find(p => p.id === id); return p ? [p] : []; });
    return presets.filter(p => chip === 'ALL' || (chip === 'NEW' ? p.isNew : p.category === chip));
}
export function templatePrice(p: Preset): string {
    const credits = plural('library.cost', p.credits);
    return p.durationSeconds ? t('libraryCreate.withSeconds', { credits, seconds: String(p.durationSeconds) }) : credits;
}
export const templatePageHref = (p: Pick<Preset, 'id'>) => ({ pathname: '/templates/[id]', params: { id: p.id } }) as const;
export const previewRatio = (p: Preset): number => Math.min(16 / 9, Math.max(9 / 16, parseRatio(p.previewAspect) ?? 9 / 16));
