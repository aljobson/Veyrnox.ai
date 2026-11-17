import { beatEnglish } from './beatDisplay.mjs';
import { prepareAsset } from './beatAssets.js';
import { isHeldError } from './beatAssetAvailability.mjs';
import { placedAlready } from './beatAiOps.mjs';
export async function loadAiResults(record, status, doc, t = beatEnglish) {
  const results = [], messages = [];
  if (['failed', 'refunded'].includes(status.state)) return { results, messages: [t('app.music.beat.details.d40')] };
  const pair = !['stems', 'targetStems'].includes(record.op);
  const candidates = pair ? status.candidates || [] : [0, 1].map(ordinal => ({ ordinal: ordinal + 1, state: 'ready' }));
  for (const c of candidates) {
    const ordinal = c.ordinal - 1, label = ordinal === 0 ? 'A' : 'B';
    if (![0, 1].includes(ordinal)) continue;
    if (['failed', 'refunded'].includes(c.state)) { messages.push(t('app.music.beat.details.d41', { label })); continue; }
    if (!['ready', 'succeeded', 'stored'].includes(c.state?.toLowerCase())) continue;
    const name = record.op === 'stems' ? (ordinal === 0 ? 'Vocals' : 'Instrumental')
      : record.op === 'targetStems' ? (ordinal === 0 ? record.instrument : `Without ${record.instrument}`)
        : `✦ ${record.prompt.slice(0, 24)} ${label}`;
    if (placedAlready(doc, record, ordinal)) {
      results.push({ ordinal, name, asset: doc.assets[record.placementIds[ordinal].asset] }); continue;
    }
    const ref = pair ? { songId: c.song_id, versionId: c.version_id, jobId: c.job_id }
      : { songId: record.source.songId, versionId: record.source.versionId, requestId: record.requestId,
        ...(record.op === 'stems' ? { part: ordinal === 0 ? 'vocals' : 'instrumental' }
          : { kind: ordinal === 0 ? 'target' : 'residual', instrument: record.instrument }) };
    try {
      const asset = await prepareAsset({ source: pair ? 'song' : record.op === 'stems' ? 'stem' : 'target', ref, name, bpm: null }, doc.tempo.bpm);
      results.push({ ordinal, name, asset });
    } catch (e) {
      if (!isHeldError(e)) throw e;
      messages.push(t('app.music.beat.details.d42', { label }));
    }
  }
  return { results, messages };
}
