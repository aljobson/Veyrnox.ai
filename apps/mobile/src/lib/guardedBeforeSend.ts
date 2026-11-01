import { aiConsent } from './aiConsentStore';
import { guardPaidAction } from './hardPaywall';

// The one beforeSend every owner-bound API client uses: the hard paywall's paid-action guard, then AI sharing consent.
export const guardedBeforeSend = async (path: string, method: string): Promise<void> => {
    guardPaidAction(path, method);
    await aiConsent.ensure(path, method);
};
