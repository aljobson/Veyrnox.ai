import type { FidelityUIContract as FidelityContract } from './templateFidelityRuntime';
import type { TemplateContractSource } from './templateClientContract';
export function clientContractFor(preset: TemplateContractSource | null | undefined, route: object | null): FidelityContract | null;
