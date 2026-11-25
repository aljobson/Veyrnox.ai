import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { colors } from '../theme';
import { EDITOR_REVIEW } from '../lib/config';

const REVIEW_PROJECT = 'c1111111-1111-4111-8111-111111111111';

export default function Index() {
    const { status } = useAuth();
    if (status === 'loading') {
        return (
            <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
                <ActivityIndicator color={colors.accent} />
            </View>
        );
    }
    return <Redirect href={status === 'signedIn'
        ? EDITOR_REVIEW ? `/editor/${REVIEW_PROJECT}` : '/(app)/(tabs)'
        : '/sign-in'} />;
}
