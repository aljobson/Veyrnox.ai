import type { SessionTask } from '../../auth/sessionTask';
import type { ApiClient } from '../api';
import type { BeatDoc, BeatRemoteAsset } from './doc';
import { ExportFailure } from './exportFailure';
import { AUDIO_RATE, usedAssets, type ExportAssetSelection, type PCMBuffer } from './exportShared';
import { createNativeAssetPort, type NativeAssetPort } from './nativeAssets';
import { loadNativeContext, type NativeOfflineContext } from './nativeContext';
import type { NativeHeldAssets } from './nativeHeldAssets';
import type { PlaybackContext } from './takePlayback';
// @ts-ignore shared document selection and release-authority guard.
import * as availability from '../../../../../app/veyrnox/_lib/music/beat/beatAssetAvailability.mjs';

export type NativeExportSelection = ExportAssetSelection;
export type NativeDirectExportAsset = BeatRemoteAsset;
export type NativeExportAssetSession = {
    preflight(selection: NativeExportSelection): Promise<void>;
    confirm(selection: NativeExportSelection): Promise<void>;
    assertAssets(selection: NativeExportSelection): void;
    prepare(asset: NativeDirectExportAsset, bpm: number, target: NativeOfflineContext): Promise<PCMBuffer>;
    releaseBatch(): Promise<void>;
    close(): Promise<void>;
};
export type NativeExportAssetSessionOptions = {
    doc: BeatDoc;
    api: ApiClient;
    task: SessionTask;
    signal: AbortSignal;
    heldAssets: NativeHeldAssets;
    deps?: { port?: NativeAssetPort; createDecoder?: () => PlaybackContext };
};

const shared = availability as unknown as {
    exportAssetDocument(doc: BeatDoc, selection: NativeExportSelection): BeatDoc;
    exportAvailabilityGuard(doc: BeatDoc, options: {
        state: NativeHeldAssets['state']; markHeld: NativeHeldAssets['markHeld'];
        request(path: string): Promise<unknown>;
    }): (selection: NativeExportSelection) => Promise<void>;
    assertNoHeldAssets(doc: BeatDoc, state: NativeHeldAssets['state']): void;
};

function exportError(error: unknown): ExportFailure {
    const code = (error as { code?: unknown })?.code;
    const status = Number((error as { status?: unknown })?.status);
    const message = (error as Error)?.message;
    if (code === 'asset_held' || code === 'held') return new ExportFailure('beatExport.assetHeld');
    if (code === 'asset_unconfirmed') return new ExportFailure('beatExport.assetUnconfirmed');
    if (code === 'account_changed' || status === 401 || message === 'account_changed' || message === 'not_authenticated') return new ExportFailure('beatExport.signIn');
    return new ExportFailure(status === 404 || status === 410 || message === 'asset_unavailable'
        ? 'beatExport.sourceUnavailable' : 'beatExport.renderError');
}

export function createNativeExportAssetSession({ doc, api, task, signal, heldAssets, deps = {} }: NativeExportAssetSessionOptions): NativeExportAssetSession {
    let decoder: PlaybackContext | null = null;
    let closed = false;
    let failure: unknown;
    let requestFailure: unknown;
    const port = deps.port ?? createNativeAssetPort(api, task, { heldAssets });
    const selected = (selection: NativeExportSelection) => shared.exportAssetDocument(doc, selection);
    const remoteAssets = (selection: NativeExportSelection) => usedAssets(selected(selection)).map(id => doc.assets?.[id])
        .filter((asset): asset is BeatRemoteAsset => !!asset && ['song', 'stem', 'target'].includes(asset.source));
    const current = () => {
        if (closed || signal.aborted) throw signal.reason ?? new Error('export_cancelled');
        if (!task.current()) throw new ExportFailure('beatExport.signIn');
    };
    const confirmRun = shared.exportAvailabilityGuard(doc, {
        state: heldAssets.state,
        markHeld: heldAssets.markHeld,
        request: path => {
            current();
            if (!task.user) throw new ExportFailure('beatExport.signIn');
            return api.request(`/api/v1${path}`, { signal }, { owner: task.user, task }).catch(error => {
                requestFailure = error;
                throw error;
            });
        },
    });
    const verify = async (selection: NativeExportSelection) => {
        current();
        if (!remoteAssets(selection).length) return;
        if (!task.user) throw new ExportFailure('beatExport.signIn');
        try { await confirmRun(selection); current(); }
        catch (error) {
            failure = error;
            if (!task.current() || Number((requestFailure as { status?: unknown })?.status) === 401) throw new ExportFailure('beatExport.signIn');
            throw error instanceof ExportFailure ? error : exportError(error);
        } finally { requestFailure = undefined; }
    };
    const releaseBatch = async () => {
        const active = decoder as (PlaybackContext & { close?(): void | Promise<void> }) | null;
        decoder = null;
        await active?.close?.();
        // A batch is the longest lifetime of extracted archive entries. Do not retain them between renders.
        port.releaseArchives?.();
    };
    return {
        preflight: verify,
        confirm: verify,
        assertAssets(selection) {
            current();
            if (failure) throw exportError(failure);
            try { shared.assertNoHeldAssets(selected(selection), heldAssets.state); }
            catch (error) { failure = error; throw exportError(error); }
        },
        async prepare(asset, bpm, target) {
            current();
            decoder ??= deps.createDecoder?.() ?? new (loadNativeContext())({ sampleRate: AUDIO_RATE }) as PlaybackContext;
            try {
                const loaded = await port.load(asset, bpm, decoder, signal);
                current();
                const copy = target.createBuffer(loaded.numberOfChannels, loaded.length, loaded.sampleRate);
                for (let channel = 0; channel < loaded.numberOfChannels; channel++) {
                    copy.getChannelData(channel).set(loaded.getChannelData(channel));
                }
                return copy;
            } catch (error) {
                throw error instanceof ExportFailure ? error : exportError(error);
            }
        },
        releaseBatch,
        async close() {
            if (closed) return;
            closed = true;
            await releaseBatch();
            port.close?.();
        },
    };
}
