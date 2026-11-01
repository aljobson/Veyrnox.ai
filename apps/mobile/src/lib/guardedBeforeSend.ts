import { aiConsent } from './aiConsentStore';
import { guardPaidAction } from './hardPaywall';

// The one beforeSend every owner-bound API client uses: the hard paywall's paid-action guard, then AI sharing consent.
// The guard runs again after consent, because the person can sit on the consent prompt while their plan lapses.
export const guardedBeforeSend = async (path: string, method: string): Promise<void> => {
    guardPaidAction(path, method);
    await aiConsent.ensure(path, method);
    guardPaidAction(path, method);
};
