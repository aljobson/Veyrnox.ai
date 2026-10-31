import type { VeyMood } from '../lib/veyMotion';
import type { PaywallGateResult, PaywallOffering } from './paywallGate';

// What Vey does and says above a RevenueCat paywall (ADR-0108 amendment 4). Every line is a key in billing.paywall.vey.*.
export type PaywallVeyEvent =
    | { type: 'open'; offering: PaywallOffering }
    | { type: 'pick' }
    | { type: 'checking' }
    | { type: 'refused'; result: Exclude<PaywallGateResult, 'ok'> }
    | { type: 'store' }
    | { type: 'cancelled' }
    | { type: 'failed' }
    | { type: 'purchased'; offering: PaywallOffering }
    | { type: 'poke' };

export interface PaywallVeyState { readonly mood: VeyMood; readonly line: string }

const REFUSED: Record<Exclude<PaywallGateResult, 'ok'>, string> = {
    not_ready: 'billing.paywall.notReady',
    busy: 'billing.paywall.busy',
    sales_closed: 'billing.paywall.salesClosed',
    generation_already_active: 'billing.paywall.alreadyActive',
};

// After a purchase only a new 'open' may change the scene, so Vey's celebration is not cut short.
export function paywallVey(state: PaywallVeyState | null, event: PaywallVeyEvent): PaywallVeyState {
    if (state?.mood === 'clap' && event.type !== 'open') return state;
    switch (event.type) {
        case 'open': return { mood: 'wave', line: `billing.paywall.vey.hello.${event.offering}` };
        case 'pick': return { mood: 'hop', line: 'billing.paywall.vey.pick' };
        case 'checking': return { mood: 'working', line: 'billing.paywall.vey.checking' };
        case 'refused': return { mood: 'worried', line: REFUSED[event.result] };
        case 'store': return { mood: 'working', line: 'billing.paywall.vey.store' };
        case 'cancelled': return { mood: 'idle', line: 'billing.paywall.vey.cancelled' };
        case 'failed': return { mood: 'worried', line: 'billing.paywall.vey.failed' };
        case 'purchased': return { mood: 'clap', line: `billing.paywall.vey.done.${event.offering}` };
        case 'poke': return { mood: 'hop', line: state?.line ?? 'billing.paywall.vey.pick' };
    }
}

// Paywall interactions that mean the person chose a plan or switched monthly/yearly.
export const isPlanPick = (componentType: string): boolean => ['package', 'tab', 'switch', 'package_selection_sheet'].includes(componentType);

// How long Vey celebrates before the paywall closes.
export const PURCHASED_HOLD_MS = 1800;
