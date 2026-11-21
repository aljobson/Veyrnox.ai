import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { tryOp, type Edit } from './doc';
import { beatStore, getBeat, listBeats, putBeat, subscribeBeats } from './store';
import { canRedo, canUndo, createHistory, record, replacePresent, travel, type History } from './history';
import { t } from '../i18n';

// Deliberately mirrors the editor's N2 boundary; extracting it there would conflict with N3.
export function useBeatEdit(id: string) {
    useSyncExternalStore(subscribeBeats, listBeats, listBeats);
    const doc = getBeat(id);
    const history = useRef<History | null>(null);
    if (doc && history.current?.present !== doc) history.current = createHistory(doc);
    const [notice, setNotice] = useState<string | null>(null);
    const [said, setSaid] = useState<string | null>(null);
    const apply = useCallback((operation: Edit, label?: string): boolean => {
        const current = getBeat(id);
        if (!current) return false;
        if (beatStore.saveState(id) === 'busy') { setNotice(t('beat.local.busy')); return false; }
        try {
            const result = tryOp(current, operation);
            if (result.refused) { setNotice(t('beat.refused', { reason: result.refused })); return false; }
            if (result.doc !== current) {
                if (!putBeat(result.doc)) { setNotice(t('beat.local.busy')); return false; }
                history.current = record(history.current ?? createHistory(current), getBeat(id)!, { label });
            }
            setNotice(null); setSaid(label ?? null); return true;
        } catch { setNotice(t('beat.refused', { reason: '' })); return false; }
    }, [id]);
    const navigate = (direction: 'undo' | 'redo') => {
        if (!history.current) return;
        const next = travel(history.current, direction);
        if (next === history.current) return;
        if (!putBeat(next.present)) { setNotice(t('beat.local.busy')); return; }
        history.current = replacePresent(next, getBeat(id)!);
        setNotice(null); setSaid(t(direction === 'undo' ? 'beat.undo' : 'beat.redo'));
    };
    return { doc, apply, undo: () => navigate('undo'), redo: () => navigate('redo'), canUndo: !!history.current && canUndo(history.current), canRedo: !!history.current && canRedo(history.current), notice, said, setNotice, busy: beatStore.saveState(id) === 'busy' };
}
