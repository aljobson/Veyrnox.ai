import { useCallback, useEffect, useRef, useState } from 'react';
import { replaceActiveStudio } from '../../lib/filmCloud';
import type { Film } from '../../lib/filmStudio';
import { t } from '../../lib/i18n';

type Edit = { film: Film; valid: () => boolean; epoch: number };
export function useFilmAutosave() {
    const [status, setStatus] = useState<'saved' | 'saving' | 'failed'>('saved');
    const [reason, setReason] = useState('');
    const pending = useRef<Edit | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const epoch = useRef(0);
    const running = useRef<Promise<void> | null>(null);
    const mounted = useRef(true);
    const clearTimer = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; }, []);
    const cancel = useCallback(() => {
        epoch.current++; clearTimer(); pending.current = null;
        if (mounted.current) { setStatus('saved'); setReason(''); }
    }, [clearTimer]);
    const flush = useCallback(async () => {
        clearTimer();
        if (running.current) await running.current.catch(() => undefined);
        while (pending.current) {
            const edit = pending.current;
            if (edit.epoch !== epoch.current || !edit.valid()) { if (pending.current === edit) pending.current = null; return; }
            const write = replaceActiveStudio(edit.film);
            running.current = write;
            try {
                await write;
                if (pending.current === edit) pending.current = null;
                if (edit.epoch === epoch.current && edit.valid() && mounted.current && !pending.current) { setStatus('saved'); setReason(''); }
            } catch (error) {
                if (edit.epoch !== epoch.current || !edit.valid()) return;
                const message = error instanceof Error ? error.message : t('filmWorkspace.saveFailed');
                if (mounted.current) { setStatus('failed'); setReason(message); }
                throw new Error(message);
            } finally { if (running.current === write) running.current = null; }
        }
    }, [clearTimer]);
    const schedule = useCallback((film: Film, valid: () => boolean) => {
        if (!valid()) return;
        pending.current = { film, valid, epoch: epoch.current };
        clearTimer(); setStatus('saving'); setReason('');
        timer.current = setTimeout(() => { void flush().catch(() => undefined); }, 600);
    }, [clearTimer, flush]);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimer(); }; }, [clearTimer]);
    return { status, reason, schedule, flush, cancel };
}
