// Typed seams over the web storage/sync rules; the implementations remain shared.
// @ts-ignore shared JavaScript module
import * as rules from '../../../../../app/veyrnox/_lib/music/beat/beatCloudRules.mjs';
// @ts-ignore shared JavaScript module
import * as storage from '../../../../../app/veyrnox/_lib/music/beat/beatStoreRules.mjs';
import type { BeatDoc } from './doc';
export type CloudLink = { userId: string; projectId: string | null; revision: number; syncedUpdatedAt?: number };
export type BeatRecord = { id: string; revision: number; cloud?: CloudLink; doc: BeatDoc; updatedAt: number };
export type SaveBody = { expected_revision: number; doc_json: string; mode: 'autosave' | 'checkpoint' | 'stash' };
export type FailureState = 'removed' | 'conflict' | 'limit' | 'rate_limited' | 'offline' | 'error';
export const validRecord = storage.validRecord as (record: unknown) => record is BeatRecord;
export const validCloudLink = storage.validCloudLink as (link: unknown) => link is CloudLink;
export const { errorState, retryDelay, needsSync, maySync, saveRequest, conflictRequest, parseCloudBeat, removedLink, isRemoved, takeAssets } = rules as {
    errorState(error: unknown): FailureState;
    retryDelay(attempt: number, error: unknown): number | null;
    needsSync(record: BeatRecord, userId: string, revision?: number): boolean;
    maySync(link: CloudLink | undefined, userId: string): boolean;
    saveRequest(doc: BeatDoc, revision: number, mode?: SaveBody['mode']): SaveBody;
    conflictRequest(choice: 'mine' | 'theirs', doc: BeatDoc, revision: number): SaveBody;
    parseCloudBeat(json: string, id: string): BeatDoc;
    removedLink(userId: string): CloudLink;
    isRemoved(link?: CloudLink): boolean;
    takeAssets(doc: BeatDoc): unknown[];
};
