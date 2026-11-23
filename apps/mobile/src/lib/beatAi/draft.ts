import { actionBody, actionEligibility, aiPaths, generateBody } from './shared';
import { t } from '../i18n';
import messages from '../i18n/messages/en/beatAi';
import type { AiDoc, Draft, Op, Selection, Song } from './types';
// Only localized phone keys leave the web helpers. Unmapped web keys are generic.
export const phoneTranslator = (key: string, params?: Record<string, string | number>) => {
    const phone = `beatAi.${key.split('.').at(-1)}`;
    return t(key.startsWith('app.music.beat.ai.a') && Object.hasOwn(messages, phone) ? phone : 'beatAi.error', params);
};
export function buildDraft(doc: AiDoc, op: Op, prompt: string, key: string, instrument: string, rights: boolean, selection: Selection | null, song: Song | null): { draft: Draft; body: object } {
    const source = op === 'generate' ? null : selection;
    if (op !== 'generate' && (!source || source.asset.source !== 'song')) throw new Error('source_required');
    if (source) {
        const reason = actionEligibility(op, doc, source.region, source.asset, song, {}, phoneTranslator);
        if (reason) throw new Error('ineligible');
    }
    const paths = aiPaths(op, source?.asset.ref.songId);
    const region = source?.region;
    const start = region?.start ?? doc.cycle.start;
    const end = region ? region.start + region.length : doc.cycle.end;
    return {
        body: source ? actionBody(op, { doc, ...source, prompt, instrument, rights }) : generateBody(doc, prompt, key),
        draft: { op, prompt, instrument, submitPath: paths.submit,
            source: source ? { songId: source.asset.ref.songId, versionId: source.asset.ref.versionId, assetId: source.region.assetId, asset: source.asset } : null,
            placement: { afterTrackId: source?.track.id ?? doc.tracks.at(-1)?.id ?? null, sourceTrackId: source?.track.id ?? null,
                ...(region ? { regionId: region.id } : {}), start, length: end - start,
                phaseSec: region?.phaseSec ?? 0,
                cycle: { ...doc.cycle } },
        },
    };
}
