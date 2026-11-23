// Typed native seams over the shared web ripple rules. Keep the guard ahead of
// the edit helper: the generic edit path is allowed to prune changed take groups.
// @ts-ignore shared JavaScript module
import * as rippleModule from '../../../../../app/veyrnox/_lib/music/beat/beatRipple.mjs';
// @ts-ignore shared JavaScript module
import * as guardModule from '../../../../../app/veyrnox/_lib/music/beat/beatRippleGuard.mjs';
import { t } from '../i18n';
import { BeatRefusal, type BeatDoc } from './doc';

export type RippleReason = 'invalid_ripple' | 'invalid_ticks' | 'region_not_found' | 'track_not_found'
    | 'ripple_inside_region' | 'ripple_nothing_to_move' | 'ripple_take_group';
const rippleReasons: readonly RippleReason[] = ['invalid_ripple', 'invalid_ticks', 'region_not_found', 'track_not_found',
    'ripple_inside_region', 'ripple_nothing_to_move', 'ripple_take_group'];
type RippleRequest = { type: 'delete'; trackId: string; regionId: string }
    | { type: 'insert'; trackId: string; atTick: number; lengthTicks: number };
type GuardResult = { ok: true } | { ok: false; reason: RippleReason };

const ripple = rippleModule as unknown as {
    rippleDeleteRegion(doc: BeatDoc, trackId: string, regionId: string): BeatDoc;
    rippleInsertGap(doc: BeatDoc, trackId: string, atTick: number, lengthTicks: number): BeatDoc;
};
const guard = guardModule as unknown as { guardRipple(doc: BeatDoc, request: RippleRequest): GuardResult };

const refusalKeys: Record<RippleReason, string> = {
    invalid_ripple: 'beat.ripple.refusal.invalid',
    invalid_ticks: 'beat.ripple.refusal.invalid',
    region_not_found: 'beat.ripple.refusal.invalid',
    track_not_found: 'beat.ripple.refusal.invalid',
    ripple_inside_region: 'beat.ripple.refusal.inside',
    ripple_nothing_to_move: 'beat.ripple.refusal.nothing',
    ripple_take_group: 'beat.ripple.refusal.takeGroup',
};

export const rippleRefusalMessage = (reason: RippleReason): string => t(refusalKeys[reason] ?? refusalKeys.invalid_ripple);

const knownReason = (value: unknown): value is RippleReason => typeof value === 'string' && rippleReasons.includes(value as RippleReason);
function runRipple(operation: () => BeatDoc): BeatDoc {
    try { return operation(); }
    catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
        if (knownReason(code)) throw new BeatRefusal(rippleRefusalMessage(code), code);
        throw error;
    }
}

function requireSafeRipple(doc: BeatDoc, request: RippleRequest): void {
    const result = guard.guardRipple(doc, request);
    if (!result.ok) throw new BeatRefusal(rippleRefusalMessage(result.reason), result.reason);
}

export function guardedRippleDelete(doc: BeatDoc, trackId: string, regionId: string): BeatDoc {
    const request = { type: 'delete', trackId, regionId } as const;
    requireSafeRipple(doc, request);
    return runRipple(() => ripple.rippleDeleteRegion(doc, trackId, regionId));
}

export function guardedRippleInsert(doc: BeatDoc, trackId: string, atTick: number, lengthTicks: number): BeatDoc {
    const request = { type: 'insert', trackId, atTick, lengthTicks } as const;
    requireSafeRipple(doc, request);
    return runRipple(() => ripple.rippleInsertGap(doc, trackId, atTick, lengthTicks));
}
