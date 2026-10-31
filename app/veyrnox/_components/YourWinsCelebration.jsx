'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { useI18n } from '../../../components/I18nProvider';
import { claimWinsCelebration, useCheckinDialogOpen } from '../_lib/yourWins';
import { Modal } from './Modal';
import VeyCharacter from './VeyCharacter';
export function YourWinsCelebration({ owner, data }) {
    const { t } = useI18n();
    const reduced = useReducedMotion();
    const checkinOpen = useCheckinDialogOpen();
    const [event, setEvent] = useState(null);
    const close = useRef(null);
    useEffect(() => {
        let live = true, claim = null;
        if (data) void claimWinsCelebration(owner, data.milestones).then(result => {
            claim = result;
            if (live && claim) setEvent({ owner, ...claim });
            else claim?.onCancel();
        });
        return () => { live = false; claim?.onCancel(); };
    }, [owner, data]);
    // Modal opens in its child effect; this parent effect runs after showModal().
    useEffect(() => {
        if (!checkinOpen && data && event?.owner === owner && close.current?.closest('dialog')?.open) event.onShown();
    }, [checkinOpen, data, event, owner]);
    if (checkinOpen || !data || !event || event.owner !== owner) return null;
    return <Modal onCancel={() => setEvent(null)} initialFocusRef={close} instant={Boolean(reduced)} aria-labelledby="wins-celebration-title" className="items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-vx-border bg-vx-panel p-6 text-center">
            <div aria-hidden="true" className="mx-auto w-40"><VeyCharacter pose="cheer" reducedMotion={reduced !== false} /></div>
            <h2 id="wins-celebration-title" className="mb-6 text-2xl font-bold">{t(`wins.${event.milestone.key}`)}</h2>
            <Link href="/app/account/wins" onClick={() => setEvent(null)} className="flex min-h-11 items-center justify-center rounded-xl bg-vx-accent px-4 text-vx-accent-ink">{t('wins.see')}</Link>
            <button ref={close} type="button" onClick={() => setEvent(null)} className="mt-2 min-h-11 w-full rounded-xl border border-vx-border px-4">{t('wins.close')}</button>
        </div>
    </Modal>;
}
