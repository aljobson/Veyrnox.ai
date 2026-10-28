import { act } from 'react';
import * as RN from 'react-native';
import { createRoot } from 'test-renderer';
import OAuthConsent from '../src/app/(app)/oauth-consent';
import { fetchRequest } from '../src/lib/oauthConsent';
import { t } from '../src/lib/i18n';
const mockToken = async () => 'token';
const mockReplace = jest.fn();
let mockId = 'authorization-123';
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ getAccessToken: mockToken }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ authorization_id: mockId }), useRouter: () => ({ replace: mockReplace }) }));
jest.mock('../src/lib/oauthConsent', () => ({ ...jest.requireActual('../src/lib/oauthConsent'), fetchRequest: jest.fn() }));
jest.mock('../src/lib/auth/accountCalls', () => ({ authedCall: jest.fn() }));
void [RN.View, RN.Text, RN.ScrollView, RN.Pressable];
test.each(['approve', 'deny', 'mismatch'])('current registered URI is checked before opening the %s callback', async action => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    mockId = 'authorization-123'; mockReplace.mockClear();
    const registered = 'assistant://auth/callback?tenant=one';
    jest.mocked(fetchRequest).mockResolvedValue({ name: 'Assistant', website: null, redirect: registered, scopes: [], publish: false });
    const callback = action === 'mismatch' ? 'assistant://evil/callback?code=1' : `${registered}&${action === 'approve' ? 'code=1&state=nonce' : 'error=access_denied&state=nonce'}`;
    require('../src/lib/auth/accountCalls').authedCall.mockResolvedValue({ redirect_url: callback });
    const open = jest.spyOn(RN.Linking, 'openURL').mockResolvedValue();
    const root = createRoot();
    try {
        await act(async () => root.render(<OAuthConsent />));
        const label = t(action === 'deny' ? 'oauth.deny' : 'oauth.approve');
        const button = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label)[0];
        await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        if (action === 'mismatch') {
            expect(open).not.toHaveBeenCalled(); expect(mockReplace).not.toHaveBeenCalled();
            expect(root.container.queryAll(n => n.children.includes(t('oac.err.redirect'))).length).toBeGreaterThan(0);
        } else { expect(open).toHaveBeenCalledWith(callback); expect(mockReplace).toHaveBeenCalledWith('/'); }
    } finally { await act(async () => root.unmount()); open.mockRestore(); }
});
