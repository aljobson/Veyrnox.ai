import type { ApiClient } from './api';

export type PublishTier = 'free' | 'publish';

interface PlanResponse {
    readonly entitlement?: { readonly tier?: string };
}

// The server is the source of truth for the plan: a subscription bought on the web, in the other
// store or on this device all show up here. Anything it cannot tell us is "unknown", never "free".
export function tierFrom(body: PlanResponse): PublishTier | null {
    const tier = body.entitlement?.tier;
    return tier === 'publish' || tier === 'free' ? tier : null;
}

export async function fetchPublishTier(api: ApiClient): Promise<PublishTier | null> {
    try {
        return tierFrom(await api.request<PlanResponse>('/api/v1/social/plan'));
    } catch {
        return null;
    }
}

export type PaywallState = 'checking' | 'subscribe' | 'active' | 'unknown';

// A store purchase made while another plan is live is charged by the store and not entitled, so the
// paywall offers a purchase only when the server says the account is on the free tier.
export function paywallState(checked: boolean, tier: PublishTier | null): PaywallState {
    if (!checked) return 'checking';
    if (tier === 'publish') return 'active';
    return tier === 'free' ? 'subscribe' : 'unknown';
}
