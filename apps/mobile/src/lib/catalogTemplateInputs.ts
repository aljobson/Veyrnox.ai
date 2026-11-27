export function catalogTemplateImageBounds(provider: string | undefined, rawMin: number, rawMax: number) {
    const cap = provider === 'seedance' ? 8 : 5;
    const min = Number.isInteger(rawMin) ? Math.max(0, Math.min(cap, rawMin)) : 1;
    const max = Number.isInteger(rawMax) ? Math.max(min, Math.min(cap, rawMax)) : min;
    return { min, max };
}
