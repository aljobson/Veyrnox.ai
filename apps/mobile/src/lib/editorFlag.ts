export const editorEnabled = (value: unknown): boolean => value === 'true';
export const EDITOR_ENABLED = editorEnabled(process.env.EXPO_PUBLIC_EDITOR_ENABLED);
export const FULL_EDITOR_ENABLED = editorEnabled(process.env.EXPO_PUBLIC_FULL_EDITOR_ENABLED);
