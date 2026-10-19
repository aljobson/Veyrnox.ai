// These are persisted project values. Translate them only while displaying them.
export const PROCESSED_FOLDER = 'Processed video';
export const ORIGINAL_CREDIT = 'Veyrnox procedural synthesizer';
export const ORIGINAL_USAGE = 'Generated locally; version 1 preset.';
export const originalFolder = category => `Original audio/${category}`;
export function storedFolderLabel(t, value) {
  if (value === PROCESSED_FOLDER) return t('app.editor.person.folder');
  if (value.startsWith('Original audio/')) return t('app.editor.original.folder', { category: value.slice('Original audio/'.length) });
  return value;
}
export function storedAttributionLabel(t, value) {
  if (value === ORIGINAL_CREDIT) return t('app.editor.original.credit');
  if (value === ORIGINAL_USAGE) return t('app.editor.original.usage');
  return value;
}
