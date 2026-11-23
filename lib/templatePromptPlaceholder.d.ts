export function templatePromptPlaceholder(id: string): string;
export function placeholderTemplateId(text: unknown): string | null;
export function isTemplatePromptPlaceholder(text: unknown): boolean;
export function hasTemplatePlaceholder(text: unknown): boolean;
export function replaceTemplatePlaceholders(text: string, replacement: (id: string) => string | null | undefined): string | null;
