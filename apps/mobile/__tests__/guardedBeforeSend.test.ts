jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: jest.fn() } }));
import { aiConsent } from '../src/lib/aiConsentStore';
import { setHardPaywallLocked } from '../src/lib/hardPaywall';
import { guardedBeforeSend } from '../src/lib/guardedBeforeSend';

afterEach(() => { setHardPaywallLocked(false); jest.mocked(aiConsent.ensure).mockReset(); });

test('a paid request is refused when the account locks while the consent prompt is open', async () => {
    jest.mocked(aiConsent.ensure).mockImplementation(async () => { setHardPaywallLocked(true); });
    await expect(guardedBeforeSend('/api/v1/generations', 'POST')).rejects.toMatchObject({ status: 402, code: 'subscription_required' });
});

test('an already locked account never reaches the consent prompt', async () => {
    setHardPaywallLocked(true);
    await expect(guardedBeforeSend('/api/v1/generations', 'POST')).rejects.toMatchObject({ code: 'subscription_required' });
    expect(aiConsent.ensure).not.toHaveBeenCalled();
});

test('an unlocked account passes through', async () => {
    jest.mocked(aiConsent.ensure).mockResolvedValue(undefined);
    await expect(guardedBeforeSend('/api/v1/generations', 'POST')).resolves.toBeUndefined();
});
