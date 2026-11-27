export function mergeOwnerProofModels<T extends { id: string }>(models: readonly T[], overlay: readonly T[]): T[];
export function createOwnerProofOverlay<T> (options: {
    load(): Promise<{ models?: T[] }>;
    current(): boolean;
    publish(models: T[]): void;
}): { clear(): void; refresh(): Promise<void> };
export function ownerProofRefusal(error: unknown): boolean;
export function ownerProofTokenEligible(token: string | null | undefined): boolean;
export function readOwnerProof<T>(url: string, token: string, request?: typeof fetch): Promise<{ models?: T[] }>;
export function createOwnerProofStore<T>(): {
 snapshot(session: string | number | null): readonly T[];
 subscribe(listener: () => void): () => void;
 session(session: string | number | null): void;
 refresh(session: string | number | null, load: () => Promise<{models?: T[]}>, force?: boolean): Promise<void>;
};

export interface OwnerProofExposure { epoch: number; models: string[] }
export function ownerProofExposure(previous: OwnerProofExposure | null, modelId: string, epoch: number, exposed: boolean, hasImage: boolean): OwnerProofExposure | null;
export function hasOwnerProofExposure(exposure: OwnerProofExposure | null, modelId: string, epoch: number): boolean;
