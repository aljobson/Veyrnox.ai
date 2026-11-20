import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { userIdFromToken } from '../../lib/appCache';
import { deviceTipStorage, tipsSeen, markTipsSeen, phoneTipSteps, type TipStorage } from '../../lib/beatNative/coachMarks';
import type { TipId } from '../../lib/beatNative/labs';
export function useBeatCoachMarks(targets: ReadonlySet<TipId>, storage: TipStorage = deviceTipStorage) {
    const { getAccessToken, generation } = useAuth();
    const [account, setAccount] = useState<{ id: string; generation: number } | null>(null);
    const [index, setIndex] = useState<number | null>(null);
    const userId = account?.generation === generation ? account.id : null;
    useEffect(() => {
        let active = true; setIndex(null); setAccount(null);
        void (async () => {
            const token = await getAccessToken?.().catch(() => null);
            const id = token ? userIdFromToken(token) : null;
            if (!active || !id) return;
            setAccount({ id, generation });
            if (!tipsSeen(storage, id)) setIndex(0);
        })();
        return () => { active = false; };
    }, [getAccessToken, generation, storage]);
    const steps = phoneTipSteps(targets);
    const finish = () => { markTipsSeen(storage, userId); setIndex(null); };
    return { canReplay: !!userId, step: userId && index !== null ? steps[index] ?? null : null, last: index === steps.length - 1,
        next: () => { if (index === null) return; if (index + 1 >= steps.length) finish(); else setIndex(index + 1); },
        skip: finish, replay: () => { if (userId) setIndex(0); } };
}
