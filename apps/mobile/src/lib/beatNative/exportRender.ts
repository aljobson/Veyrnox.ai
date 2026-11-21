import type { BeatDoc } from './doc';
import { beatTakes, configureNativeTakeStorage, hydrateBeatTakes, loadBeatTake, type TakeRow } from './takeShared';
import { loadNativeOfflineContext, withWindowOfflineContext, type AdapterReport, type NativeOfflineCtor, type NativeOfflineContext } from './nativeContext';
import { assembleExport, createWavWriter, encodeWav, exportFilename, MB, planExport, renderBeat, renderSong, usedAssets, type ExportOptions, type ExportPlan, type SongBuffers } from './exportShared';

import { ExportFailure } from './exportFailure';
export { ExportFailure } from './exportFailure';
const reverseUsed = (doc: BeatDoc, id: string) => doc.tracks.some(t => t.regions.some(r => r.assetId === id && r.reverse));
export function assertNativeSources(doc: BeatDoc) {
    if (usedAssets(doc).some(id => doc.assets?.[id]?.source !== 'take')) throw new ExportFailure('beatExport.source');
}
/** Include the entire shared JS sample cache, even audio removed from this document. No loads or native allocations here. */
export function nativeExportBytes(doc: BeatDoc, plan: Pick<ExportPlan, 'frames' | 'bitDepth'>, cached: TakeRow[] = beatTakes(), stemTrackIds?: string[]): number {
    let bytes = cached.reduce((sum, row) => sum + (row.samples?.length ?? 0) * 4, 0);
    const loaded = new Set<string>();
    const lengths = new Map<string, number>();
    for (const id of usedAssets(doc)) {
        const asset = doc.assets![id], row = cached.find(take => take.id === asset.ref);
        const length = row?.samples?.length ?? row?.length ?? Math.ceil(asset.durationSec * 48000);
        if (!row?.samples && !loaded.has(asset.ref)) bytes += length * 4;
        loaded.add(asset.ref);
        lengths.set(id, length);
    }
    const sets = stemTrackIds ? stemTrackIds.map(id => trackDoc(doc, id)) : [doc];
    const nativeBytes = Math.max(0, ...sets.map(part => usedAssets(part).reduce((sum, id) =>
        sum + lengths.get(id)! * 4 * (reverseUsed(part, id) ? 2 : 1), 0)));
    return bytes + nativeBytes + plan.frames * 2 * 4 + 44 + plan.frames * 2 * plan.bitDepth / 8;
}
const trackDoc = (doc: BeatDoc, id?: string): BeatDoc => id ? { ...doc, tracks: doc.tracks.filter(track => track.id === id) } : doc;
async function checkExportTakes(doc: BeatDoc) {
    let missing = 0;
    for (const id of usedAssets(doc)) if (!await loadBeatTake(doc.assets![id].ref).catch(() => null)) missing++;
    if (missing) throw new ExportFailure(missing === 1 ? 'beatExport.missingOne' : 'beatExport.missingMany', { count: missing });
}
export async function prepareExportBuffers(doc: BeatDoc, context: NativeOfflineContext): Promise<SongBuffers> {
    const buffers: SongBuffers = new Map();
    for (const id of usedAssets(doc)) {
        const take = await loadBeatTake(doc.assets![id].ref).catch(() => null);
        if (!take) { buffers.set(id, { missing: true }); continue; }
        const buffer = context.createBuffer(1, take.samples.length, take.sampleRate);
        buffer.getChannelData(0).set(take.samples);
        let reverse;
        if (reverseUsed(doc, id)) {
            reverse = context.createBuffer(1, take.samples.length, take.sampleRate);
            const to = reverse.getChannelData(0);
            for (let i = 0; i < to.length; i++) to[i] = take.samples[to.length - 1 - i];
        }
        buffers.set(id, { buffer, reverse, missing: false });
    }
    const count = [...buffers.values()].filter(b => b.missing).length;
    if (count) { buffers.clear(); throw new ExportFailure(count === 1 ? 'beatExport.missingOne' : 'beatExport.missingMany', { count }); }
    return buffers;
}
export type RenderedExport = { bytes: ArrayBuffer; filename: string; report: AdapterReport };
export type RenderDeps = { Context?: NativeOfflineCtor | null; progress?(seconds: number, total: number): void; current?(): boolean };
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
        if (nativeExportBytes(doc, plan, beatTakes(), options.output === 'stems' ? tracks.map(track => track.id!) : undefined) > 300 * MB) throw new ExportFailure('beatExport.phone');
        // Verify the entire export before sharing its first stem. This populates only the shared JS sample cache.
        if (options.output === 'stems') { await checkExportTakes(doc); check(); }
        for (const track of tracks) {
            check(); deps.progress?.(0, plan.frames / plan.sampleRate);
            const buffers = await prepareExportBuffers(trackDoc(doc, track.id), make(1, 1, plan.sampleRate));
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
