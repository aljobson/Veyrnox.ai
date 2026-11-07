export function routeForContract(contract: { class: string; modelId: string; slotCount?: number } | null | undefined, legacyModelId: string | null, referenceCount?: number): { modelId: string | null; boundModelId: string | null; slotCount: number; bindingReady: boolean };

export function templateRouteContract(id: string | null | undefined): { class: string; modelId: string; slotCount: number; aspect: string | null } | null;
export function templateRoute(preset: { id?: string }, legacyModelId: string | null, count?: number): ReturnType<typeof routeForContract>;
