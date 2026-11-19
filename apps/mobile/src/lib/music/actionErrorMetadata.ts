import { ApiError } from '../api';
import { isFiniteNumber } from '../responseShapes';
export type ActionErrorMetadata = Readonly<{ source_duration_seconds?: number; max_duration_seconds?: number }>;
export function actionErrorMetadata(error: unknown): ActionErrorMetadata | null {
    if (!(error instanceof ApiError)) return null;
    const source = error.body.source_duration_seconds, max = error.body.max_duration_seconds;
    const result = { ...(isFiniteNumber(source) && source >= 0 ? { source_duration_seconds: source } : {}),
        ...(isFiniteNumber(max) && max >= 0 ? { max_duration_seconds: max } : {}) };
    return Object.keys(result).length ? Object.freeze(result) : null;
}
