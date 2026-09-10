/**
 * Row types matching packages/db/schema/0001_initial.sql. Kept minimal —
 * only the columns the ledger and queue code needs. Add more as slices
 * beyond 1 need them.
 */

export type UUID = string;

export type JobState =
  | "PRICED"
  | "DEBITED"
  | "SUBMITTED"
  | "SUCCEEDED"
  | "FAILOVER"
  | "FAILED"
  | "REFUNDED"
  | "STORED";

export interface UserRow {
  id: UUID;
  clerk_id: string;
  email: string;
  plan: "free" | "starter" | "plus" | "ultra";
  created_at: Date;
  updated_at: Date;
}

export interface CreditBalanceRow {
  user_id: UUID;
  balance: number;
  updated_at: Date;
}

export interface LedgerEntryRow {
  id: UUID;
  user_id: UUID;
  delta: number;
  reason: string;
  job_id: UUID | null;
  created_at: Date;
}

export interface JobRow {
  id: UUID;
  user_id: UUID;
  idempotency_key: string;
  model_id: string;
  credits: number;
  state: JobState;
  provider: string | null;
  provider_job_id: string | null;
  error_code: string | null;
  inputs: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Driver-agnostic pool interface. Both `pg.Pool` and
 * `@neondatabase/serverless`'s `Pool` implement this shape by design,
 * so the same Ledger code runs in tests (pg + local Postgres) and in
 * production (Neon serverless in a Worker).
 */
export interface PgLikeClient {
  query<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  release(): void;
}

export interface PgLikePool {
  connect(): Promise<PgLikeClient>;
  query<T = unknown>(
    sql: string,
    params?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  end(): Promise<void>;
}
