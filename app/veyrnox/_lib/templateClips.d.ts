export type TemplateClipModelId = 'seedance-2.0-reference' | 'seedance-2.0-reference-kie';
export const TEMPLATE_CLIP_MODELS: Readonly<Record<TemplateClipModelId, string>>;
export function isTemplateClipModel(id: unknown): id is TemplateClipModelId;
export interface TemplateClip { readonly id: string; readonly name: string; readonly kind: 'recast' }
export const TEMPLATE_CLIPS: readonly { readonly id: string; readonly previewFile: string }[];
export function publicTemplateClip(id: unknown, clips?: readonly { readonly id: string; readonly previewFile: string }[]): TemplateClip | null;
