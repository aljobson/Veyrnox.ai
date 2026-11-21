import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { userIdFromToken } from '../../lib/appCache';
import { deviceTipStorage, tipsSeen, markTipsSeen, tipAt, tipAfter, type TipStorage } from '../../lib/beatNative/coachMarks';
import { BEAT_TIP_STEPS, type TipId } from '../../lib/beatNative/labs';
export function useBeatCoachMarks(targets: ReadonlySet<TipId>, storage: TipStorage = deviceTipStorage) {
    const { getAccessToken, generation } = useAuth();
    const [account, setAccount] = useState<{ id: string; generation: number } | null>(null);
    const [current, setCurrent] = useState<TipId | null>(null);
    const userId = account?.generation === generation ? account.id : null;
    useEffect(() => {
        let active = true; setCurrent(null); setAccount(null);
        void (async () => {
            const token = await getAccessToken?.().catch(() => null);
            const id = token ? userIdFromToken(token) : null;
            if (!active || !id) return;
            setAccount({ id, generation });
            if (!tipsSeen(storage, id)) setCurrent(BEAT_TIP_STEPS[0].id);
        })();
        return () => { active = false; };
    }, [getAccessToken, generation, storage]);
    const step = userId && current !== null ? tipAt(current, targets) : null;
    const finish = () => { markTipsSeen(storage, userId); setCurrent(null); };
    return { canReplay: !!userId, step, last: !!step && !tipAfter(step.id, targets),
        next: () => { if (!step) return; const after = tipAfter(step.id, targets); if (after) setCurrent(after.id); else finish(); },
        skip: finish, replay: () => { if (userId) setCurrent(BEAT_TIP_STEPS[0].id); } };
}
