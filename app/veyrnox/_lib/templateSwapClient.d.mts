import type { Size, Box, Result } from '../../../lib/templateSwapCutout.mjs';
export interface SwapOffer { id: string; model: 'kling-o1-reference'; credits: number; durationSeconds: 5; images: 2 | 4; role: string; people?: 2; roles?: [string, string]; fullBody?: true; name?: string }
export interface SwapFile { uri: string; size: number; type: 'image/png'; width: number; height: number }
export interface Reference { slot: 'image'; origin: 'upload'; key: string }
export interface SwapBody { template_swap: string; model_id: string; idempotency_key: string; inputs: Record<string, never>; max_charge_credits: number; references: Reference[]; consent: true }
export interface Attempt { accountId: string; templateId: string; key: string; state: string; files?: SwapFile[]; urls?: string[]; photo?: unknown; body?: SwapBody; references?: Reference[]; job_id?: string; uncertain?: boolean; refusal?: boolean; responses?: number; errorCode?: string; balance?: number; spent?: number }
export type Gateway = <T = Record<string, unknown>>(path: string, init?: RequestInit) => Promise<T>;
export interface LookupJob { id: string; state: 'queued' | 'running' | 'succeeded' | 'failed'; refunded: boolean; refund_state: 'confirmed' | 'pending' | 'none' | 'unknown' }
export function fetchSwapAvailability(id: string, fetcher?: typeof fetch, signal?: AbortSignal): Promise<SwapOffer | null>;
export function faceBoxFromResult(result: { count: number; landmarks: Float32Array }, size: Size): Result<{ faceBox: Box }>;
export function swapRequest(offer: SwapOffer, key: string, references: Reference[]): SwapBody;
export function swapImageCounts(offer: SwapOffer | null | undefined): number[];
export function swapFullBody(offer: SwapOffer | null | undefined): boolean;
export function unsettled(a: Attempt): boolean;
export function reduceAttempt(a: Attempt, event: { error?: { code?: string; status?: number; body?: Record<string, unknown> }; job?: LookupJob; accepted?: { job_id: string; balance_after?: number; free_allowance?: boolean } }): Attempt;
export function lookupJobByKey(key: string, gateway: Gateway, signal?: AbortSignal): Promise<LookupJob | null>;
export function swapErrorKey(code?: string): string;
