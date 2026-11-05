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

/** One immediate same-tab handoff. The file is never serialized or persisted. */
export function writeTemplateMediaHandoff(target, { templateId, modelId, image }, now = Date.now()) {
  if (!target || !TEMPLATE_ID.test(String(templateId || '')) || !MODEL_ID.test(String(modelId || '')) || templateImageFileError(image)) return false;
  try {
    target[KEY] = { at: now, templateId, modelId, image };
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
  if (now - value.at < 0 || now - value.at > MAX_AGE_MS || templateImageFileError(value.image)) return null;
  return { image: value.image };
}
