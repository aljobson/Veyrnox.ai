export function submitErrorCode(code: string): string;
export interface Batch { keys: string[]; accepted: unknown[]; unknown: Set<number> }
export function createBatch(count: number, makeKey: () => string): Batch;
export function sendInOrder(count: number, send: (index: number) => Promise<unknown>, batch?: Batch, makeKey?: () => string): Promise<{ started: number; error: unknown }>;
