export const TEMPLATE_CLIP_PROMPT: string;
export const TEMPLATE_CLIP_PROMPT_MAX: number;
export function normalizeTemplateClipPrompt(value: unknown): string;
export function validTemplateClipPrompt(value: unknown): boolean;
export function templateClipPhotoPrompt(text: string, attached: boolean): string;
export function templateClipSegments(text: string): ({ text: string; token?: never } | { token: string; text?: never })[];
export function templateClipProviderPrompt(value: unknown, model: string): string | null;
