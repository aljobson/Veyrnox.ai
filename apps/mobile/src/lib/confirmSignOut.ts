import { Alert } from 'react-native';
import { t } from './i18n';
export function confirmSignOut(signOut: () => Promise<void>) {
    Alert.alert(t('account.signOutConfirm'), undefined, [
        { text: t('acct.cancel'), style: 'cancel' },
        { text: t('public.account.signOut'), style: 'destructive', onPress: () => { void signOut(); } },
    ]);
}
