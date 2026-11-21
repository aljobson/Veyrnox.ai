import { isRecord } from '../responseShapes';
import { uuid, validQuote, validCandidate } from './client';
import { barChoices } from './shared';
import type { MagicPending } from './types';
import { receiptStore } from './storage';
import type { BeatFiles } from '../beatNative/persist';
export const validMagicPending = (v: unknown): v is MagicPending => isRecord(v) && uuid(v.owner) && uuid(v.beatId) && uuid(v.quoteId)
    && typeof v.key === 'string' && v.key.startsWith('magic.') && uuid(v.key.slice(6)) && validQuote(v.quote)
    && typeof v.prompt === 'string' && v.prompt.trim().length > 0 && v.prompt.length <= 400
    && typeof v.bpm === 'number' && Number.isFinite(v.bpm) && v.bpm >= 40 && v.bpm <= 220 && barChoices(v.bpm).includes(v.bars as number)
    && Number.isSafeInteger(v.createdAt) && (v.createdAt as number) >= 0 && (v.requestId === undefined || uuid(v.requestId))
    && (v.terminal === undefined || ['succeeded', 'partial', 'ready', 'failed', 'refunded'].includes(v.terminal as string))
    && (v.candidates === undefined || Array.isArray(v.candidates) && v.candidates.length <= 2 && v.candidates.every(validCandidate));
export const magicPendingStore = (files?: BeatFiles) => receiptStore('magic', validMagicPending, files);
