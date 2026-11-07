import type { TemplateContractSource } from '../../../../lib/templateClientContract';

// Reuse source objects already returned by the feed/detail API. Discovery never
// constructs a contract or token map; the selected-template reader does that.
const sources = new Map<string, TemplateContractSource>();
export function rememberTemplateSource(preset: TemplateContractSource) {
    if (preset.id) sources.set(preset.id, preset);
}
export function readTemplateSource(id: string) { return sources.get(id); }
