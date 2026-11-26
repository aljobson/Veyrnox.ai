import { readBoundedBody } from './boundedBody.js';

export const CRUN_TEMPLATE_PROVIDERS = Object.freeze({
  kling: Object.freeze({ path: '/api/v1/client/job/kling-templates', language: true }),
  seedance: Object.freeze({ path: '/api/v1/client/job/bytedance-templates', language: false }),
  vidu: Object.freeze({ path: '/api/v1/client/job/vidu-templates', language: false }),
});

const API_BASE = 'https://api.crun.ai';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 240;
const MAX_REQUIREMENTS = 12;

const cleanText = (value, max = MAX_TEXT) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const cleanNumber = value => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 1_000_000) / 1_000_000 : null;
};
const cleanUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
};
const cleanList = (value, max = 12) => Array.isArray(value)
  ? value.map(item => cleanText(item, 120)).filter(Boolean).slice(0, max)
  : [];

function previewKind(value) {
  const url = cleanUrl(value);
  if (!url) return null;
  return /\.(?:mp4|m4v|mov|webm)(?:$|\?)/i.test(url) ? 'video' : 'image';
}

function infoPairs(info) {
  if (!Array.isArray(info)) return [];
  const pairs = [];
  for (const section of info.slice(0, 6)) {
    const labels = Array.isArray(section?.labels) ? section.labels : [];
    const values = Array.isArray(section?.values) ? section.values : [];
    for (let index = 0; index < Math.min(labels.length, values.length); index += 1) {
      const label = cleanText(labels[index], 80);
      const value = cleanText(values[index], 200);
      if (label && value) pairs.push({ label, value });
      if (pairs.length >= MAX_REQUIREMENTS) return pairs;
    }
  }
  return pairs;
}

function normalizeKling(template) {
  const id = cleanText(template?.key, 100);
  const name = cleanText(template?.name, 160);
  if (!id || !name) return null;
  return {
    id,
    name,
    category: cleanText(template.category, 80) || 'Kling effects',
    tag: cleanText(template.tag, 40) || null,
    coverUrl: cleanUrl(template.cover_url),
    previewUrl: cleanUrl(template.video_url),
    previewKind: 'video',
    providerCredits: cleanNumber(template.credit),
    requirements: infoPairs(template.info),
  };
}

function normalizeSeedance(template) {
  const id = cleanText(template?.TemplateId, 100);
  const name = cleanText(template?.Title_en || template?.Title, 160);
  if (!id || !name) return null;
  const prices = Array.isArray(template.ConsumeItems) ? template.ConsumeItems.map(item => ({
    resolution: cleanText(item?.Resolution, 20),
    providerCredits: cleanNumber(item?.Credit),
  })).filter(item => item.resolution && item.providerCredits !== null).slice(0, 8) : [];
  const tags = cleanList(template.Tags_en?.length ? template.Tags_en : template.Tags, 8);
  return {
    id,
    name,
    category: cleanText(template.TemplateType, 80) || 'ByteDance effects',
    tag: tags[0] || null,
    tags,
    coverUrl: cleanUrl(template.Cover),
    previewUrl: cleanUrl(template.PreviewVideo),
    previewKind: 'video',
    durationMs: Number.isInteger(template.Duration) && template.Duration > 0 ? template.Duration : null,
    inputCount: Number.isInteger(template.InputNum) && template.InputNum > 0 ? Math.min(template.InputNum, 8) : null,
    inputRequirement: cleanText(template.InputRequirement, 120) || null,
    aspectRatio: cleanText(template.CoverAspectRatio, 24) || null,
    supportedAspects: cleanList(String(template.SupportAspectRatio || '').split(','), 12),
    prices,
    seedance2: tags.some(tag => /seedance\s*2(?:\.0)?/i.test(tag)),
  };
}

function viduRequirements(template) {
  const requirements = [
    { label: 'Resolution', value: cleanList(template.resolution, 8).join(', ') },
    { label: 'Duration', value: Array.isArray(template.duration) ? template.duration.slice(0, 8).map(value => cleanNumber(value)).filter(value => value !== null && value > 0).map(value => `${value}s`).join(', ') : '' },
    { label: 'Aspect ratio', value: cleanList(template.aspect_ratio, 8).join(', ') },
    { label: 'Output type', value: cleanText(template.output_type, 80) },
  ].filter(item => item.value);

  let instructions = template.input_instruction;
  if (typeof instructions === 'string') {
    try {
      instructions = JSON.parse(instructions);
    } catch {
      instructions = null;
    }
  }
  if (!instructions || Array.isArray(instructions) || typeof instructions !== 'object') return requirements;
  for (const [rawLabel, rawValue] of Object.entries(instructions)) {
    if (requirements.length >= MAX_REQUIREMENTS) break;
    if (rawLabel === 'person_count') continue;
    const label = cleanText(rawLabel.replaceAll('_', ' '), 80);
    const value = Array.isArray(rawValue) ? cleanList(rawValue, 4).join(', ') : cleanText(rawValue, 200);
    if (label && value) requirements.push({ label, value });
  }
  return requirements;
}

function normalizeVidu(template) {
  const id = cleanText(template?.template, 120);
  const name = cleanText(template?.name, 160);
  if (!id || !name) return null;
  const previewUrl = cleanUrl(template.video);
  return {
    id,
    name,
    category: cleanText(template.category_name, 80) || 'Vidu effects',
    tag: template.is_new === true ? 'NEW' : template.is_hot === true ? 'HOT' : null,
    coverUrl: cleanUrl(template.cover),
    previewUrl,
    previewKind: previewKind(previewUrl),
    providerCredits: cleanNumber(template.credits),
    inputRequirement: cleanText(template.person_count, 160) || null,
    requirements: viduRequirements(template),
  };
}

export function normalizeCrunTemplateCatalog(provider, payload, page, pageSize) {
  const normalizer = provider === 'kling' ? normalizeKling
    : provider === 'seedance' ? normalizeSeedance
      : provider === 'vidu' ? normalizeVidu : null;
  if (!normalizer || payload?.code !== 200 || !Array.isArray(payload?.data?.templates)) {
    throw new Error('invalid_catalog_response');
  }
  const templates = payload.data.templates.map(normalizer).filter(Boolean);
  const total = Number.isInteger(payload.data.total) && payload.data.total >= 0 ? payload.data.total : templates.length;
  return { provider, total, page, pageSize, templates };
}

export async function readCrunTemplateCatalog({ provider, page = 1, pageSize = 50, language = 'en' }, {
  apiKey = process.env.CRUN_API_KEY,
  fetchImpl = fetch,
  timeoutMs = 8_000,
} = {}) {
  const config = CRUN_TEMPLATE_PROVIDERS[provider];
  if (!config) return { ok: false, error: 'provider_invalid', status: 400 };
  if (!apiKey) return { ok: false, error: 'not_configured', status: 503 };
  const safePage = Number.isInteger(page) && page >= 1 && page <= 1_000 ? page : null;
  const safeSize = Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 50 ? pageSize : null;
  if (!safePage || !safeSize || !['en', 'zh'].includes(language)) return { ok: false, error: 'query_invalid', status: 400 };

  const url = new URL(config.path, API_BASE);
  url.searchParams.set('page', String(safePage));
  url.searchParams.set('page_size', String(safeSize));
  if (config.language) url.searchParams.set('language', language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { 'x-api-key': apiKey, accept: 'application/json' },
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, error: 'catalog_unavailable', status: 502 };
    const bytes = await readBoundedBody(response.body, MAX_BODY_BYTES, controller.signal);
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    return { ok: true, catalog: normalizeCrunTemplateCatalog(provider, payload, safePage, safeSize) };
  } catch {
    return { ok: false, error: 'catalog_unavailable', status: 502 };
  } finally {
    clearTimeout(timer);
  }
}

export async function readCrunTemplateSummary(options = {}) {
  const providers = Object.keys(CRUN_TEMPLATE_PROVIDERS);
  const results = await Promise.all(providers.map(provider => readCrunTemplateCatalog({
    provider,
    page: 1,
    pageSize: 1,
    language: 'en',
  }, options)));
  const failed = results.find(result => !result.ok);
  if (failed) return failed;
  const counts = Object.fromEntries(results.map(result => [result.catalog.provider, result.catalog.total]));
  return {
    ok: true,
    summary: {
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      providers: counts,
    },
  };
}
