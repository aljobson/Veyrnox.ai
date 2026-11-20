/** A touch may edit only after a hold and a subsequent drag. No React or timers. */
export function createHoldDrag<Kind extends string>() {
    let kind: Kind | null = null, armed = false, captured = false, suppressTap = false;
    const clear = () => { kind = null; armed = false; captured = false; };
    return {
        begin(next: Kind) { clear(); kind = next; suppressTap = false; },
        arm() { if (kind !== null) { armed = true; suppressTap = true; } },
        canCapture(dx: number, dy: number, touches: number, disabled: boolean, vertical = false) {
            return armed && !captured && !disabled && touches === 1 && (vertical
                ? Math.abs(dy) > 5 && Math.abs(dy) > Math.abs(dx)
                : Math.abs(dx) + Math.abs(dy) > 3);
        },
        capture() { if (!armed) return null; armed = false; captured = true; return kind; },
        finish() { const result = captured ? kind : null; clear(); return result; },
        cancel: clear,
        // A captured drag commits in the responder's release callback, whose event order can vary.
        releaseTouch() { if (!captured) clear(); },
        isCaptured: () => captured,
        suppressesTap: () => suppressTap,
    };
}
