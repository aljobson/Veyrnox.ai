import { readCrunTemplateCatalog, crunTemplateCostMicrousd, VEYRNOX_PROVIDER_COST_PER_CREDIT } from './crunTemplateCatalog.js';

export const CRUN_TEMPLATE_PUBLIC_MODEL = 'catalog-template';
export const CRUN_TEMPLATE_MODELS = Object.freeze({
  kling: Object.freeze({ id: 'crun-catalog-kling-template', endpoint: 'crun:kling/template' }),
  seedance: Object.freeze({ id: 'crun-catalog-seedance-template', endpoint: 'crun:bytedance/template' }),
  vidu: Object.freeze({ id: 'crun-catalog-vidu-template', endpoint: 'crun:vidu/template' }),
});

const CATALOG_ID = /^(kling|seedance|vidu):(\d{1,4}):(\d{1,2}):[A-Za-z0-9._-]{1,120}$/;

export async function loadCrunTemplateGeneration(body, options = {}) {
  const request = body?.catalog_template;
  if (!request || body?.model_id !== CRUN_TEMPLATE_PUBLIC_MODEL || typeof request !== 'object' || Array.isArray(request)) return null;
  const match = CATALOG_ID.exec(String(request.catalog_id || ''));
  if (!match || request.provider !== match[1]) return { error: 'catalog_template_not_found', status: 404 };
  const page = Number(match[2]);
  const result = await readCrunTemplateCatalog({ provider: request.provider, page, pageSize: 50, language: 'en' }, options);
  if (!result.ok) return { error: result.error === 'not_configured' ? 'gateway_not_configured' : 'catalog_template_unavailable', status: result.status };
  const template = result.catalog.templates.find(item => item.catalogId === request.catalog_id);
  if (!template) return { error: 'catalog_template_not_found', status: 404 };
  const price = request.provider === 'seedance'
    ? template.prices?.find(item => item.resolution === request.resolution)
    : { providerCredits: template.providerCredits, credits: template.credits };
  if (!price || !Number.isFinite(price.providerCredits) || !Number.isInteger(price.credits) || price.credits < 1) {
    return { error: 'catalog_template_price_unavailable', status: 503 };
  }
  const costMicrousd = crunTemplateCostMicrousd(price.providerCredits);
  if (costMicrousd === null) return { error: 'catalog_template_price_unavailable', status: 503 };
  if (costMicrousd > price.credits * Math.round(VEYRNOX_PROVIDER_COST_PER_CREDIT * 1_000_000)) {
    return { error: 'catalog_template_price_unavailable', status: 503 };
  }
  const model = CRUN_TEMPLATE_MODELS[request.provider];
  return {
    provider: request.provider, modelId: model.id, endpoint: model.endpoint, template,
    credits: price.credits, costMicrousd, resolution: request.provider === 'seedance' ? price.resolution : null,
    minInputs: template.minInputCount ?? template.inputCount ?? 1,
    maxInputs: template.maxInputCount ?? template.inputCount ?? 1,
    billing: {
      version: 1, provider: request.provider, catalog_id: template.catalogId,
      template_id: template.providerTemplateId, provider_credits: price.providerCredits,
      cost_microusd: costMicrousd, credits: price.credits,
      ...(request.provider === 'seedance' ? { resolution: price.resolution } : {}),
    },
  };
}

export function crunTemplateProviderInputs(selection, imageUrls) {
  const shared = { image_url: Array.isArray(imageUrls) ? imageUrls : imageUrls ? [imageUrls] : [], template_id: selection.template.providerTemplateId };
  if (selection.provider === 'seedance') return { ...shared, resolution: selection.resolution };
  if (selection.provider === 'vidu') return { ...shared, bgm: false };
  return shared;
}
