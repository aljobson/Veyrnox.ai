export const editorEnabled = (value: unknown): boolean => value === 'true';
export const editorDefaultEnabled = (value: unknown): boolean => value !== 'false';
export const EDITOR_ENABLED = editorEnabled(process.env.EXPO_PUBLIC_EDITOR_ENABLED);
export const FULL_EDITOR_ENABLED = editorEnabled(process.env.EXPO_PUBLIC_FULL_EDITOR_ENABLED);
export const EDITOR_SERVER_EXPORT_ENABLED = editorEnabled(process.env.EXPO_PUBLIC_EDITOR_SERVER_EXPORT_ENABLED);
export const EDITOR_ORGANIZATION_ENABLED = editorEnabled(process.env.EXPO_PUBLIC_EDITOR_ORGANIZATION_ENABLED);

export const EDITOR_AI_EDIT_ENABLED = editorEnabled(process.env.EXPO_PUBLIC_EDITOR_AI_EDIT_ENABLED);

export const EDITOR_SPEECH_CUT_ENABLED = editorEnabled(process.env.EXPO_PUBLIC_EDITOR_SPEECH_CUT_ENABLED);
// Scenes is local-only and carries no credit or service dependency. It ships on unless explicitly disabled for rollback.
export const EDITOR_SCENES_ENABLED = editorDefaultEnabled(process.env.EXPO_PUBLIC_EDITOR_SCENES_ENABLED);
// Clip Finder is local-only and carries no credit or service dependency. It ships on unless explicitly disabled for rollback.
export const EDITOR_CLIPS_ENABLED = editorDefaultEnabled(process.env.EXPO_PUBLIC_EDITOR_CLIPS_ENABLED);
