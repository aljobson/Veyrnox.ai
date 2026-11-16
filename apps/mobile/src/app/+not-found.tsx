import { View } from 'react-native';
import { EmptyState } from '../components/EmptyState';
import { t } from '../lib/i18n';
import { colors } from '../theme';

// A path with no screen (a stale or mistyped link) used to bounce silently to the root. It now says the link could not
// be opened. The button goes to the root, which sends a signed-in person to the tabs and anyone else to sign-in, so
// it works signed out too. Valid links never reach here: the sign-in/Publish callbacks are handled in +native-intent.
export default function NotFound() {
    return (
        <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
            <EmptyState title={t('notFound.title')} body={t('notFound.body')} actionLabel={t('notFound.action')} href="/" />
        </View>
    );
}
