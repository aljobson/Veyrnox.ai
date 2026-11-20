export const JOB_STATES: readonly string[];
export function publicJobState(state: string): 'queued' | 'running' | 'succeeded' | 'failed';
export function publicErrorCode(code: unknown): string | undefined;
