export interface TemplateClip { readonly id: string; readonly name: string; readonly kind: 'recast' }
export const TEMPLATE_CLIPS: readonly TemplateClip[];
export function publicTemplateClip(id: unknown, clips?: readonly TemplateClip[]): TemplateClip | null;
