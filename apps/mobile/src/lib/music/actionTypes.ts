import type { ApiClient } from '../api';
export type MusicActionQuote = Readonly<{
    quote_id: string; model_id: string; total_credits: number; balance: number; balance_after: number;
    affordable: boolean; expires_at: string; outputs: readonly string[];
}>;
export type StemStart = Readonly<{
    request_id: string; job_id: string; state: string; balance_after?: number; idempotent?: true;
}>;
export type StemRequest = Readonly<{
    id: string; song_id: string; source_version_id: string; job_id: string; model_id: string; credits: number;
    created_at: string; state: 'queued' | 'running' | 'ready' | 'failed' | 'refunded'; archive_url: string | null;
}>;
export type StemArchive = Readonly<{ url: string; mime_type: 'application/zip'; size_bytes: number; expires_in: number }>;
export type CropInput = Readonly<{ version_id: string; start_seconds: number; end_seconds: number }>;
export type CropResult = Readonly<{
    version_id: string; version_number: number; render_state: 'canonical' | 'preview_only'; idempotent: boolean; format?: string;
}>;
export type ActionInput = Readonly<{
    song_id: string; version_id: string; rights_confirmed: boolean; parameters?: Readonly<Record<string, unknown>>;
}>;
export type ActionSpec<R extends { balance_after?: number }, S> = Readonly<{
    name: string; keyPrefix: string; definitiveCodes: ReadonlySet<string>;
    quote(api: ApiClient, input: ActionInput): Promise<MusicActionQuote>;
    confirm(api: ApiClient, quoteId: string, key: string): Promise<R>;
    beforeConfirm?(): Promise<void>;
    status(api: ApiClient, result: R): Promise<S>;
    terminal(status: S): boolean;
}>;
