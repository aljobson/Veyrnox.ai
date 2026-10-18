import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { CinemaPlayer } from '../../../../components/cinema/CinemaPlayer';

// Full-screen player for one film, short or episode. The token is minted when this screen opens.
export default function Watch() {
    const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: title ?? 'Now playing' }} />
            <CinemaPlayer contentId={id} />
        </View>
    );
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#000' } });
