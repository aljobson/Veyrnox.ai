import type { Attempt } from './templateSwapClient.mjs';
export interface Ticket { accountId: string | null; epoch: number; key: string }
export interface SwapStore {
 subscribe(cb: () => void): () => void; revision(): number; owner(): string | null; get(templateId: string): Attempt[];
 session(next: string | null, reason?: string): void; put(a: Attempt): boolean; ticket(key: string): Ticket; valid(ticket: Ticket): boolean;
 update(ticket: Ticket, changes: Partial<Attempt>): boolean; controller(key: string): AbortController; release(controller: AbortController): void;
 dropFiles(key: string): void; dispose(key: string): void;
}
export function createSwapStore(options?: { revoke?: (url: string) => void }): SwapStore;
