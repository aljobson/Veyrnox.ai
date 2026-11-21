import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { PurchaseOutcome } from '../../billing/storePurchaseStore';
import type { PaywallReason } from '../../lib/paywallPrompt';
import type { VeyMood } from '../../lib/veyMotion';
import { playError, playSelection, playSuccess } from '../../lib/haptics';
import { purchaseOutcomeText } from '../credits/PurchaseOutcomeState';

export function usePaywallFeedback(reason: PaywallReason, outcome: PurchaseOutcome | null, busy: boolean, onClose: () => void) {
    const base: VeyMood = reason === 'depleted' ? 'worried' : 'idle';
    const [mood, setMood] = useState<VeyMood>(reason === 'first' ? 'wave' : base);
    const reactionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(reactionTimer.current), []);
    const [still, setStill] = useState<boolean | null>(null);
    const message = purchaseOutcomeText(outcome);
    useEffect(() => {
        let live = true;
        void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (live) setStill(value); }).catch(() => { if (live) setStill(true); });
        const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
        return () => { live = false; sub.remove(); };
    }, []);
    useEffect(() => {
        if (reason !== 'first' || outcome || busy) return;
        reactionTimer.current = setTimeout(() => setMood('idle'), 1260);
        return () => clearTimeout(reactionTimer.current);
    }, [reason, outcome, busy]);
    useEffect(() => {
        if (outcome?.kind === 'credited' || outcome?.kind === 'subscribed') void playSuccess();
        if (outcome?.kind === 'error' || outcome?.kind === 'sales_closed') void playError();
    }, [outcome]);
    useEffect(() => {
        if (!outcome) return;
        clearTimeout(reactionTimer.current);
        if (outcome?.kind === 'credited' || outcome?.kind === 'subscribed') {
            setMood('clap');
            if (still === null) return;
            // useAnnouncement above runs before this effect, including with Reduce Motion.
            if (still) { onClose(); return; }
            const cheer = setTimeout(() => setMood('cheer'), 700);
            const close = setTimeout(onClose, 1500);
            return () => { clearTimeout(cheer); clearTimeout(close); };
        }
        if (outcome?.kind === 'cancelled') setMood(base);
        if (outcome?.kind === 'error' || outcome?.kind === 'sales_closed') setMood('worried');
        if (outcome?.kind === 'pending') setMood('working');
    }, [outcome, still, base, onClose]);
    return { mood: busy ? 'working' as const : mood, message, still,
        choose: () => {
            void playSelection(); clearTimeout(reactionTimer.current); setMood('hop');
            reactionTimer.current = setTimeout(() => setMood(base), 980);
        } };
}
