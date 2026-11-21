import { isRecord } from '../responseShapes';
import { isSectionUuid } from './validateSectionActions';
import { RENDER_OPERATIONS, type RenderOperation } from './renderForm';

export type RenderResult = Readonly<{ version_id: string; version_number: number; operation: RenderOperation;
    render_state: 'canonical'; idempotent: boolean; format?: 'wav'; duration_seconds?: number }>;
export function isRenderResult(value: unknown): value is RenderResult {
    if (!isRecord(value) || !isSectionUuid(value.version_id) || !Number.isSafeInteger(value.version_number)
        || (value.version_number as number) < 1 || !RENDER_OPERATIONS.includes(value.operation as RenderOperation)
        || value.render_state !== 'canonical' || typeof value.idempotent !== 'boolean') return false;
    const full = value.format === 'wav' && typeof value.duration_seconds === 'number'
        && Number.isFinite(value.duration_seconds) && value.duration_seconds > 0;
    return full || (value.idempotent === true && !('format' in value) && !('duration_seconds' in value));
}
