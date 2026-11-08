import { clientContractFor } from '../../../../lib/templateClientContractRuntime';
import { rememberTemplateSource, readTemplateSource } from './templateSourceCache';
export { rememberTemplateSource } from './templateSourceCache';
import { templateRouteContract } from './templateRoute';
import type { FidelityUIContract as FidelityContract } from '../../../../lib/templateFidelityRuntime';
export { templatePhotoHints, templatePhotosUnavailable, templateBoundPrompt, fidelityBlocked, fidelityTemplateId, templatePhotoError } from '../../../../lib/templateFidelityRuntime';
export { templateRoute } from './templateRoute';

export function templateContract(id: string | null | undefined): FidelityContract | null {
    return id ? clientContractFor(readTemplateSource(id), templateRouteContract(id)) : null;
}
export { templateRouteContract };

export async function fetchTemplateContract(id: string, base: string): Promise<FidelityContract | null> {
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return null;
    const response = await fetch(`${base}/api/templates/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('template_detail_unavailable');
    const body = await response.json();
    if (body?.template?.id !== id) throw new Error('template_detail_mismatch');
    rememberTemplateSource(body.template);
    return templateContract(id);
}
