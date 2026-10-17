import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../auth/AuthProvider';
import { Logo } from '../../components/Logo';
import { colors } from '../../theme';

export default function AppLayout() {
    const { status } = useAuth();
    if (status === 'signedOut') return <Redirect href="/sign-in" />;
    return (
        <Stack
            screenOptions={{
                headerStyle: { backgroundColor: colors.background },
                headerTintColor: colors.text,
                headerBackButtonDisplayMode: 'minimal',
                contentStyle: { backgroundColor: colors.background },
            }}
        />
    );
}
