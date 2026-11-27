import { isRecord } from '../responseShapes';
import { pairQuote } from './validateGenerationActions';
import type { MusicRemixQuote, RemixActionKind } from './remixActionTypes';

export const isRemixActionKind = (value: unknown): value is RemixActionKind => value === 'mashup' || value === 'sample';

export function isMusicRemixQuote(value: unknown, expectedKind?: RemixActionKind): value is MusicRemixQuote {
    if (!pairQuote(value) || !isRecord(value) || !isRemixActionKind(value.kind)) return false;
    if (expectedKind && value.kind !== expectedKind) return false;
    return value.model_id === `stable-audio-3-${value.kind}`;
}
