import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { HeaderAction } from '../../../../components/HeaderAction';
import { isTitleId } from '../../../../lib/cinemaBrowse';
import { t } from '../../../../lib/i18n';
import { CinemaPlayer } from '../../../../components/cinema/CinemaPlayer';

// Full-screen player for one film, short or episode. The token is minted when this screen opens.
export default function Watch() {
    const { id, title, position, series } = useLocalSearchParams<{ id: string; title?: string; position?: string; series?: string }>();
    const router = useRouter();
    const navigation = useNavigation();
    // Remove the player, returning to the existing parent or replacing a direct watch link.
    const allEpisodes = typeof series === 'string' && isTitleId(series)
        ? () => {
            const href = `/cinema/${series.toLowerCase()}` as const;
            const hasParent = navigation.getState()?.routes.some(route =>
                route.name === 'cinema/[id]' && route.params && 'id' in route.params && typeof route.params.id === 'string' && route.params.id.toLowerCase() === series.toLowerCase());
            if (hasParent) router.dismissTo(href);
            else router.replace(href);
        } : null;
    return (
        <View style={styles.screen}>
            <Stack.Screen options={{ title: title ?? 'Now playing', ...(allEpisodes ? { headerRight: () => <HeaderAction label={t('cinemaSeries.allEpisodes')} onPress={allEpisodes} /> } : {}) }} />
            <CinemaPlayer contentId={id} resumePosition={Number(position ?? 0)} />
        </View>
    );
}

const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: '#000' } });
