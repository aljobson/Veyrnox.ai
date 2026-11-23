export const SUNO_CONTRACT = 'crun-suno-v1';

export const SUNO_CONTROL_DEFAULTS = Object.freeze({
  instrumental: false,
  rightsConfirmed: false,
  sunoModel: 'v6',
  vocalGender: 'auto',
  styleWeight: 0.5,
  weirdness: 0.5,
  durationSeconds: null,
  variety: 1,
  excludeStyles: '',
});

export function isSunoContract(model) {
  return model?.provider_contract === SUNO_CONTRACT;
}

export function sunoControlsForModel(model, controls) {
  return model?.instrumental_only ? { ...controls, instrumental: true } : controls;
}

export function preserveSunoDraftText(server, local) {
  const sameIdentity = server?.id && local?.id && server.id === local.id
    && server.provider_contract === local.provider_contract;
  return sameIdentity ? { ...server, lyrics: local.lyrics, styles: local.styles, title: local.title } : server;
}

export function sunoFormatEditsUnavailable(capabilities) {
  return capabilities?.playback === true
    && (capabilities.render === false || capabilities.crop === false);
}

export function sunoLimit(model, field) {
  const counter = model?.counters?.[field];
  if (Number.isSafeInteger(counter?.max) && counter.max > 0) return counter.max;
  const limit = model?.limits?.[field];
  return Number.isSafeInteger(limit) && limit > 0 ? limit : null;
}

export function sunoDuration(model, wanted) {
  const bounds = model?.controls?.duration_seconds;
  if (!bounds) return null;
  const fallback = Number(bounds.default);
  const value = wanted !== null && wanted !== undefined && Number.isFinite(Number(wanted)) ? Number(wanted) : fallback;
  return Math.min(Number(bounds.max), Math.max(Number(bounds.min), Math.round(value)));
}

export function sunoVarietyValue(index) {
  return Math.min(4, Math.max(0, Number(index) || 0)) * 25;
}

/** The Suno model to send: the preferred one when the projection allows it, else the first allowed (a tripped model breaker removes choices). */
export function sunoModelFor(model, preferred = 'v6') {
  const list = Array.isArray(model?.controls?.suno_model) ? model.controls.suno_model : null;
  if (!list || !list.length) return preferred;
  return list.includes(preferred) ? preferred : list[0];
}

export function sunoSimpleQuoteRequest({ model, prompt, instrumental }) {
  return {
    mode: 'simple',
    provider_contract: model.provider_contract,
    model_id: model.id,
    prompt: String(prompt || '').trim(),
    instrumental: instrumental === true,
    suno_model: sunoModelFor(model),
  };
}

export function sunoCustomQuoteRequest({ model, draft, controls }) {
  return {
    mode: 'custom',
    provider_contract: model.provider_contract,
    draft_id: draft.id,
    draft_revision: draft.revision,
    instrumental: controls.instrumental === true,
    rights_confirmed: controls.instrumental ? false : controls.rightsConfirmed === true,
    duration_seconds: sunoDuration(model, controls.durationSeconds),
    suno_model: sunoModelFor(model, controls.sunoModel),
    vocal_gender: controls.instrumental ? 'auto' : controls.vocalGender,
    style_influence: Math.round(Number(controls.styleWeight) * 100),
    weirdness: Number(controls.weirdness),
    variety: sunoVarietyValue(controls.variety),
    exclude_styles: String(controls.excludeStyles || '').trim(),
  };
}

export function sunoCustomReady({ model, draft, controls }) {
  if (!isSunoContract(model) || !model.generation_modes?.includes('custom') || model.available === false) return false;
  if (!draft) return false;
  if (!String(draft.styles || '').trim()) return false;
  if (!controls.instrumental && (!String(draft.lyrics || '').trim() || !controls.rightsConfirmed)) return false;
  return true;
}

export function appendSunoStyle(current, value, max) {
  const parts = String(current || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!parts.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) parts.push(value);
  return capSunoText(parts.join(', '), max);
}

export function capSunoText(value, max) {
  const points = Array.from(String(value || ''));
  return Number.isSafeInteger(max) && max >= 0 && points.length > max ? points.slice(0, max).join('') : points.join('');
}
