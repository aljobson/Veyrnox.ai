import { useMusicAvailable } from '../../lib/music/useMusicAvailable';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { rawText } from '../../lib/i18n/translate';
import { AUDIO_STUDIOS, audioTarget, type AudioStudioId } from '../../lib/audioHub';
import { t } from '../../lib/i18n';
import { fetchCatalogCached, type CatalogModel } from '../../lib/media';
import { ds } from '../../theme';
import { Card, ListRow, Text, themedStyles, useThemedStyles } from '../../components/ui';
import type { MenuIcon } from '../../lib/menuIcons';

const ICON: Record<AudioStudioId, MenuIcon> = { yourMusic: 'audio', music: 'audio', speech: 'audio', dialogue: 'chat', dub: 'video' };
const copy = (): Record<AudioStudioId, { title: string; blurb: string }> => ({
    yourMusic: { title: t('music.title'), blurb: t('music.entryBody') },
    music: { title: t('audioHub.music.title'), blurb: t('audioHub.music.blurb') },
    speech: { title: t('audioHub.speech.title'), blurb: t('audioHub.speech.blurb') },
    dialogue: { title: t('audioHub.dialogue.title'), blurb: t('audioHub.dialogue.blurb') },
    dub: { title: t('audioHub.dub.title'), blurb: t('audioHub.dub.blurb') },
});

// The Audio pillar, as on the web: four cards, each opening a studio that already exists.
export default function AudioHub() {
    const styles = useThemedStyles(sheets);
    const router = useRouter();
    const text = copy();
    const musicAvailable = useMusicAvailable();
    const [models, setModels] = useState<CatalogModel[] | null>(null);
    useEffect(() => { void fetchCatalogCached((list) => setModels(list)).catch(() => {}); }, []);
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('audioHub.title') }} />
            <Text variant="title1" accessibilityRole="header">{t('audioHub.title')}</Text>
            <Text variant="body" tone="secondary">{t('audioHub.intro')}</Text>
            <Card>
                <View>
                    {(musicAvailable ? ['yourMusic' as const, ...AUDIO_STUDIOS] : AUDIO_STUDIOS).map((id) => (
                        <ListRow
                            key={id}
                            icon={ICON[id]}
                            accessibilityRole="button"
                            accessibilityLabel={rawText(text[id].title)}
                            title={<Text variant="bodyStrong">{text[id].title}</Text>}
                            subtitle={text[id].blurb}
                            onPress={() => router.push(audioTarget(id, models) as never)}
                        />
                    ))}
                </View>
            </Card>
        </ScrollView>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: ds.space.lg, gap: ds.space.md },
}));
