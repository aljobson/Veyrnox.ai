// @ts-ignore Pure server parser; no server feature flags are evaluated on the phone.
import { parseMusicLocalRender as parse } from '../../../../../lib/musicEditing.js';

export const RENDER_OPERATIONS = ['fade', 'speed', 'reorder', 'remaster', 'reverse'] as const;
export type RenderOperation = typeof RENDER_OPERATIONS[number];
export type RenderForm = Readonly<{ operation: RenderOperation; fadeIn: number; fadeOut: number; speed: number; split: number; peak: number }>;
export const initialRenderForm: RenderForm = { operation: 'fade', fadeIn: 1, fadeOut: 1, speed: 1.1, split: 1, peak: -2 };
export type RenderInput = { version_id: string } & (
    | { operation: 'fade'; fade_in_seconds: number; fade_out_seconds: number }
    | { operation: 'speed'; speed_ratio: number }
    | { operation: 'reorder'; split_seconds: number; order: [2, 1] }
    | { operation: 'remaster'; target_peak_dbfs: number }
    | { operation: 'reverse' }
);
export const parseRender = parse as (v: unknown) => { ok: true } | { ok: false; error: string };
export function renderInput(form: RenderForm, version_id: string): RenderInput {
    const { operation } = form;
    switch (operation) {
        case 'fade': return { operation, version_id, fade_in_seconds: form.fadeIn, fade_out_seconds: form.fadeOut };
        case 'speed': return { operation, version_id, speed_ratio: form.speed };
        case 'reorder': return { operation, version_id, split_seconds: form.split, order: [2, 1] };
        case 'remaster': return { operation, version_id, target_peak_dbfs: form.peak };
        case 'reverse': return { operation, version_id };
    }
}
export function renderFormError(form: RenderForm, version: string, duration: number | null): string | null {
    const input = renderInput(form, version), parsed = parseRender({ ...input, idempotency_key: 'render.validation' });
    if (!parsed.ok) return parsed.error;
    if (input.operation !== 'fade' && input.operation !== 'reorder') return null;
    if (duration === null || !Number.isFinite(duration) || duration <= 0) return 'duration_required';
    if (input.operation === 'fade' && input.fade_in_seconds + input.fade_out_seconds > duration) return 'fade_range_invalid';
    if (input.operation === 'reorder' && input.split_seconds > duration - 1) return 'reorder_range_invalid';
    return null;
}
// Integer ticks avoid cumulative floating-point drift in 0.05/0.5 controls.
export const stepRenderValue = (value: number, step: number, direction: -1 | 1, min: number, max: number) =>
    Math.max(min, Math.min(Math.floor(max / step) * step, Math.round((Math.round(value / step) + direction) * step * 100) / 100));
