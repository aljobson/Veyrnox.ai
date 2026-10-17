import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { colors } from '../../theme';

export default function AppLayout() {
    const { status } = useAuth();
    if (status === 'signedOut') return <Redirect href="/sign-in" />;
    return (
        <Stack
            screenOptions={{
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.text,
                contentStyle: { backgroundColor: colors.background },
            }}
        />
    );
}
