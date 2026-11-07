import { pickerAccept, uploadPlan } from '../../../lib/uploadInputTypes.mjs';

const KEY = '__veyrnoxTemplateMediaV1';
const MAX_AGE_MS = 10 * 60 * 1000;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const TEMPLATE_ID = /^[a-z0-9-]{1,40}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;

export const TEMPLATE_IMAGE_ACCEPT = pickerAccept('image');

export function templateImageFileError(file) {
  if (!(file instanceof Blob) || file.size < 1) return 'unreadable';
  if (uploadPlan(file)?.kind !== 'image') return 'format';
  if (file.size > MAX_IMAGE_BYTES) return 'size';
  return '';
}

export function clearTemplateMediaHandoff(target) {
  if (!target) return false;
  try {
    delete target[KEY];
    return true;
  } catch {
    return false;
  }
}

export function hasTemplateMediaHandoff(target) {
  if (!target) return false;
  try {
    return Boolean(target[KEY]);
  } catch {
    return false;
  }
}

export function templateMediaHandoffMatches(target, templateId) {
  if (!target) return false;
  try {
    return Boolean(target[KEY] && target[KEY].templateId === templateId);
  } catch {
    return false;
  }
}

/** One immediate same-tab handoff. The file is never serialized or persisted. */
export function writeTemplateMediaHandoff(target, { templateId, modelId, image, images }, now = Date.now()) {
  const files = images === undefined ? [image] : images;
  if (!Array.isArray(files) || files.length < 1 || files.length > 9 || Array.from(files).some(templateImageFileError)) return false;
  if (!target || !TEMPLATE_ID.test(String(templateId || '')) || !MODEL_ID.test(String(modelId || ''))) return false;
  try {
    target[KEY] = { at: now, templateId, modelId, ...(images === undefined ? { image } : { images: [...images] }) };
    return true;
  } catch {
    return false;
  }
}

export function takeTemplateMediaHandoff(target, templateId, modelId, now = Date.now()) {
  if (!target) return null;
  let value;
  try {
    value = target[KEY];
    if (!clearTemplateMediaHandoff(target)) return null;
  } catch {
    return null;
  }
  if (!value || value.templateId !== templateId || value.modelId !== modelId || !Number.isFinite(value.at)) return null;
  const files = value.images || [value.image];
  if (!Array.isArray(files) || files.length < 1 || files.length > 9 || Array.from(files).some(templateImageFileError)) return null;
  if (now - value.at < 0 || now - value.at > MAX_AGE_MS) return null;
  return value.images ? { images: [...value.images] } : { image: value.image };
}
