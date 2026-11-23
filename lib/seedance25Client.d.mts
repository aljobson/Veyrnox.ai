export type ClipOffer = { id: string; credits: number; gated?: boolean; media?: Record<string, { required?: boolean; maxFiles?: number }>; capabilities?: { media?: Record<string, { required?: boolean; maxFiles?: number }> } | null };
export type ClipQuote = { model_id: string; credits: number; units: number; source_seconds: number };
export function seedance25Models<T extends ClipOffer>(models: readonly T[]): T[];
export function createSeedance25Session(deps: { request(path: string, body: unknown): Promise<any>; makeKey(): string; reference(): Promise<unknown>; current?(): boolean }): {
 readonly attempted: boolean; quote(model: ClipOffer, prompt: string): Promise<ClipQuote>; submit(): Promise<{ job_id: string }>;
};
