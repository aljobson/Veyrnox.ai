import { t } from '../../lib/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { framesIn, timelineOf, type Timeline } from '../../lib/nativeEditorModel';
import type { BestCutPlan } from '../../lib/bestCutPlan';
import type { useFullEditorSession } from './useFullEditorSession';
import { BestCutSheet } from './BestCutSheet';
import { BestCutResult } from './BestCutResult';
import { useBestCutAvailability } from './useBestCutAvailability';
type Session = ReturnType<typeof useFullEditorSession>;
export function useBestCutEditor(session: Session, projectId: string, autoOpen: boolean) {
    const { quote } = useBestCutAvailability(session.api);
    const [open, setOpen] = useState(false), [comparison, setComparison] = useState<{ before: Timeline; plan: BestCutPlan | null; captionsOmitted?: boolean; refunded?: number } | null>(null);
    const opened = useRef(false), captured = useRef<{ revision: number; owner: string | undefined } | null>(null);
    const launch = useCallback(() => { captured.current = { revision: session.getEditRevision(), owner: getCacheUser() }; session.setPlaying(false); setOpen(true); }, [session]);
    useEffect(() => { if (autoOpen && quote && session.document && session.sync.draftDecided && !session.sync.sheet && !opened.current) { opened.current = true; launch(); } }, [autoOpen, quote, session.document, session.sync.draftDecided, session.sync.sheet, launch]);
    useEffect(() => subscribeCacheUser(() => { setOpen(false); setComparison(null); }), []);
    // After Undo the document equals the 'before' snapshot: the comparison would be meaningless, so it goes away.
    const after = session.document ? timelineOf(session.document.timeline) : null;
    const changed = useMemo(() => !!comparison && !!after && JSON.stringify(after) !== JSON.stringify(comparison.before), [comparison, after]);
    return {
        available: !!quote, launch,
        result: comparison && after && changed ? <BestCutResult onOpen={() => session.setPlaying(false)} before={comparison.before} after={after} plan={comparison.plan} captionsOmitted={comparison.captionsOmitted} refunded={comparison.refunded} api={session.api} uris={session.localMediaUris} /> : null,
        sheet: open && quote ? <BestCutSheet api={session.api} projectId={projectId} quote={quote} onClose={() => setOpen(false)} onApply={value => {
            const current = session.currentDocument();
            if (!current || current.project_id !== projectId || !session.sync.live() || session.sync.replacing || captured.current?.owner !== getCacheUser() || captured.current?.revision !== session.getEditRevision()) return false;
            const currentTimeline = timelineOf(current.timeline);
            const before = framesIn(currentTimeline) === 0 ? value.before : currentTimeline;
            const historyBase = framesIn(currentTimeline) === 0 ? { ...current, schema_version: 3 as const, timeline: before } : undefined;
            if (!session.markDocument({ ...current, schema_version: 3, timeline: value.timeline }, true, historyBase)) {
                session.setProblem(t('editorEditGate.invalid')); return false;
            }
            session.setLocalMediaUris(uris => ({ ...uris, ...value.uris }));
            session.setPlaying(false); session.setFrame(0); session.setSelection(null); session.setSelections([]);
            setComparison({ before, plan: value.plan, captionsOmitted: value.captionsOmitted, refunded: value.refunded }); return true;
        }} /> : null,
    };
}
