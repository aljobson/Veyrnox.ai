import type { BeatDoc } from './doc';
import { beatTakes, configureNativeTakeStorage, hydrateBeatTakes, loadBeatTake, type TakeRow } from './takeShared';
import { loadNativeOfflineContext, withWindowOfflineContext, type AdapterReport, type NativeOfflineCtor, type NativeOfflineContext } from './nativeContext';
import { AUDIO_RATE, assembleExport, checkDecoded, createWavWriter, encodeWav, exportFilename, exportSeed, MB, planExport, renderBeat,
    renderSong, renderStarterSound, seededRandom, soundDuration, usedAssets, validAsset,
    type ExportOptions, type ExportPlan, type OfflineContextFactory, type PCMBuffer, type SongBuffers } from './exportShared';

import { ExportFailure } from './exportFailure';
export { ExportFailure } from './exportFailure';
const reverseUsed = (doc: BeatDoc, id: string) => doc.tracks.some(t => t.regions.some(r => r.assetId === id && r.reverse));
function nativeAsset(doc: BeatDoc, id: string) {
    const asset = doc.assets?.[id];
    if (asset?.source !== 'take' && asset?.source !== 'sound') throw new ExportFailure('beatExport.source');
    if (asset.source === 'sound' && !validAsset(asset, doc.tempo.bpm)) throw new ExportFailure('beatExport.renderError');
    return asset;
}
export function assertNativeSources(doc: BeatDoc) {
    for (const id of usedAssets(doc)) nativeAsset(doc, id);
}
/** Include the entire shared JS sample cache, even audio removed from this document. No loads or native allocations here. */
export function nativeExportBytes(doc: BeatDoc, plan: Pick<ExportPlan, 'frames' | 'bitDepth'>, cached: TakeRow[] = beatTakes(), stemTrackIds?: string[]): number {
    let bytes = cached.reduce((sum, row) => sum + (row.samples?.length ?? 0) * 4, 0);
    const loaded = new Set<string>();
    const preparedBytes = new Map<string, number>();
    const soundBytes = new Map<string, number>();
    for (const id of usedAssets(doc)) {
        const asset = nativeAsset(doc, id);
        if (asset.source === 'take') {
            const row = cached.find(take => take.id === asset.ref);
            const length = row?.samples?.length ?? row?.length ?? Math.ceil(asset.durationSec * AUDIO_RATE);
            if (!row?.samples && !loaded.has(asset.ref)) bytes += length * 4;
            loaded.add(asset.ref);
            preparedBytes.set(id, length * 4);
        } else {
            const pcm = Math.round(soundDuration(asset.ref, doc.tempo.bpm) * AUDIO_RATE) * 2 * 4;
            preparedBytes.set(id, pcm); soundBytes.set(id, pcm);
        }
    }
    const sets = stemTrackIds ? stemTrackIds.map(id => trackDoc(doc, id)) : [doc];
    const nativePeak = Math.max(0, ...sets.map(part => {
        const ids = usedAssets(part);
        const prepared = ids.reduce((sum, id) => sum + preparedBytes.get(id)! * (reverseUsed(part, id) ? 2 : 1), 0);
        const activeSound = Math.max(0, ...ids.map(id => soundBytes.get(id) ?? 0));
        return prepared + activeSound * 2 + (activeSound ? AUDIO_RATE * 4 : 0);
    }));
    return bytes + nativePeak + plan.frames * 2 * 4 + 44 + plan.frames * 2 * plan.bitDepth / 8;
}
const trackDoc = (doc: BeatDoc, id?: string): BeatDoc => id ? { ...doc, tracks: doc.tracks.filter(track => track.id === id) } : doc;
async function checkExportSources(doc: BeatDoc) {
    let missing = 0;
    for (const id of usedAssets(doc)) {
        const asset = nativeAsset(doc, id);
        if (asset.source === 'take' && !await loadBeatTake(asset.ref).catch(() => null)) missing++;
    }
    if (missing) throw new ExportFailure(missing === 1 ? 'beatExport.missingOne' : 'beatExport.missingMany', { count: missing });
}
type PrepareDeps = { make?: OfflineContextFactory; check?(): void };
const copyBuffer = (context: NativeOfflineContext, source: PCMBuffer) => {
    const copy = context.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
    for (let channel = 0; channel < source.numberOfChannels; channel++) copy.getChannelData(channel).set(source.getChannelData(channel));
    return copy;
};
const reverseBuffer = (context: NativeOfflineContext, source: PCMBuffer) => {
    const reverse = context.createBuffer(source.numberOfChannels, source.length, source.sampleRate);
    for (let channel = 0; channel < source.numberOfChannels; channel++) {
        const from = source.getChannelData(channel), to = reverse.getChannelData(channel);
        for (let frame = 0; frame < to.length; frame++) to[frame] = from[to.length - 1 - frame];
    }
    return reverse;
};
export async function prepareExportBuffers(doc: BeatDoc, context: NativeOfflineContext, deps: PrepareDeps = {}): Promise<SongBuffers> {
    const buffers: SongBuffers = new Map();
    try {
        for (const id of usedAssets(doc)) {
            const asset = nativeAsset(doc, id);
            let buffer: PCMBuffer | undefined;
            if (asset.source === 'take') {
                const take = await loadBeatTake(asset.ref).catch(() => null);
                if (!take) { buffers.set(id, { missing: true }); continue; }
                buffer = context.createBuffer(1, take.samples.length, take.sampleRate);
                buffer.getChannelData(0).set(take.samples);
            } else {
                if (!deps.make) throw new Error('offline_unavailable');
                deps.check?.();
                const rendered = await renderStarterSound(asset.ref, doc.tempo.bpm, deps.make, seededRandom(exportSeed(doc)));
                deps.check?.(); checkDecoded(rendered, asset);
                buffer = copyBuffer(context, rendered);
            }
            const reverse = reverseUsed(doc, id) ? reverseBuffer(context, buffer) : undefined;
            buffers.set(id, { buffer, reverse, missing: false });
        }
        const count = [...buffers.values()].filter(b => b.missing).length;
        if (count) throw new ExportFailure(count === 1 ? 'beatExport.missingOne' : 'beatExport.missingMany', { count });
        return buffers;
    } catch (error) {
        buffers.clear(); throw error;
    }
}
export type RenderedExport = { bytes: ArrayBuffer; filename: string; report: AdapterReport };
export type RenderDeps = { Context?: NativeOfflineCtor | null; progress?(seconds: number, total: number): void; current?(): boolean; retainedBytes?(): number };
/** Render/consume one stem at a time. No native buffer or output is retained in UI state. */
export async function renderNativeExport(doc: BeatDoc, options: ExportOptions, consume: (result: RenderedExport) => Promise<void>, deps: RenderDeps = {}) {
    const report: AdapterReport = { gaps: [], latencyHint: 'offline' };
    const check = () => { if (deps.current && !deps.current()) throw new ExportFailure('beatExport.signIn'); };
    const Context = deps.Context === undefined ? loadNativeOfflineContext() : deps.Context;
    return withWindowOfflineContext(Context, report, async make => {
        check();
        if (options.kind === 'pattern') {
            deps.progress?.(0, options.loops * doc.steps * 60 / doc.tempo.bpm / 4);
            const rendered = await renderBeat(doc, options.loops, options.editTrackId); check();
            deps.progress?.(rendered.samples.length / rendered.sampleRate, rendered.samples.length / rendered.sampleRate);
            await consume({ bytes: encodeWav(rendered.samples, rendered.sampleRate), filename: exportFilename(doc.title), report });
            return;
        }
        assertNativeSources(doc);
        if (!doc.tracks.some(t => t.regions.length)) throw new ExportFailure('beatExport.empty');
        const plan = planExport(doc, { ...options, phone: true });
        configureNativeTakeStorage(); await hydrateBeatTakes(); check();
        const tracks = options.output === 'stems' ? plan.tracks.filter(t => t.audible) : [{ id: undefined, filename: exportFilename(doc.title) }];
        if (!tracks.length) throw new ExportFailure('beatExport.empty');
        if (nativeExportBytes(doc, plan, beatTakes(), options.output === 'stems' ? tracks.map(track => track.id!) : undefined) + (deps.retainedBytes?.() ?? 0) > 300 * MB) throw new ExportFailure('beatExport.phone');
        // Verify the whole document before constructing the first native context or sharing a stem.
        await checkExportSources(doc); check();
        for (const track of tracks) {
            check(); deps.progress?.(0, plan.frames / plan.sampleRate);
            const buffers = await prepareExportBuffers(trackDoc(doc, track.id), make(1, 1, plan.sampleRate), { make, check });
            let bytes: ArrayBuffer;
            try {
                check();
                bytes = await assembleExport(plan, chunk => renderSong(doc, { buffers, range: options.range, soloTrackId: track.id, ...chunk }), createWavWriter(plan));
            } finally { buffers.clear(); }
            check(); deps.progress?.(plan.frames / plan.sampleRate, plan.frames / plan.sampleRate);
            await consume({ bytes, filename: track.filename, report });
        }
    });
}
