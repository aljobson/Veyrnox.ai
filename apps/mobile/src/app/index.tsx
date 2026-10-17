import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { colors } from '../theme';

export default function Index() {
    const { status } = useAuth();
    if (status === 'loading') {
        return (
            <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
                <ActivityIndicator color={colors.accent} />
            </View>
        );
    }
    return <Redirect href={status === 'signedIn' ? '/(app)' : '/sign-in'} />;
}
