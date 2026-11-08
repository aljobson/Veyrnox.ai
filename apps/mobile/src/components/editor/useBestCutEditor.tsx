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
            let before = timelineOf(current.timeline);
            if (framesIn(before) === 0) {
                before = value.before;
                session.markDocument({ ...current, schema_version: 3, timeline: before }, false);
            }
            session.markDocument({ ...current, schema_version: 3, timeline: value.timeline });
            session.setLocalMediaUris(uris => ({ ...uris, ...value.uris }));
            session.setPlaying(false); session.setFrame(0); session.setSelection(null); session.setSelections([]);
            setComparison({ before, plan: value.plan, captionsOmitted: value.captionsOmitted, refunded: value.refunded }); return true;
        }} /> : null,
    };
}
