import type { SwapStore } from './templateSwapStore.mjs';
import type { SwapFile, SwapOffer, Gateway } from './templateSwapClient.mjs';
export interface PhotoResult { files: SwapFile[]; transform?: unknown; faceBox?: unknown }
export function createSwapActions(store: SwapStore, deps: {
 makeKey(): string; processPhoto(file: unknown, options: { signal: AbortSignal }): Promise<PhotoResult>;
 upload(file: SwapFile, options: { signal: AbortSignal }): Promise<string>; gateway: Gateway;
 objectURL?(file: SwapFile): string; revokeURL?(url: string): void; wait?(ms: number, signal: AbortSignal): Promise<void>;
 refreshOffer?(id: string): void; balanceChanged?(): void; discardPhoto?(result: PhotoResult): void;
 jobStarted?(job: { job_id: string; model_id: string; credits: number; templateId: string; name?: string }): void;
}): { choose(id: string, file: unknown, person?: 0 | 1): Promise<void>; submit(id: string, offer: SwapOffer): Promise<void>; reconcile(id: string, key: string): Promise<void>; cancel(key: string): void };
export const POLL_LIMIT: number;
export function pollDelay(index: number): number;
export function waitForPoll(ms: number, signal: AbortSignal): Promise<void>;
