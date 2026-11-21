import { isRecord } from '../responseShapes';
import { uuid, validQuote } from './client';
import { validPending } from './shared';
import type { Pending } from './types';
import { receiptStore } from './storage';
import type { BeatFiles } from '../beatNative/persist';
export const validPhonePending = (v: unknown): v is Pending => isRecord(v) && validPending(v) && uuid(v.owner) && uuid(v.beatId) && validQuote(v.quote);
export const pendingStore = (files?: BeatFiles) => receiptStore('parts', validPhonePending, files);
